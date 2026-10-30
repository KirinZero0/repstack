import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isTicketToken, parseQrToken, parseTicketToken, verifyQrToken, verifyTicketToken } from "@/lib/qr";
import { passIsCancelled, passTitle, passWindow } from "@/lib/guestPass";
import { bookingWhen, bookingWindow } from "@/lib/fieldBooking";
import { evaluateAndLogCheckin } from "@/lib/checkin";

const checkinSchema = z.object({ token: z.string().min(1) });

type ResultCode = "INVALID" | "GYM_SUSPENDED" | "UNAUTHENTICATED" | "MALFORMED" | "FROZEN" | "EXPIRED" | "DUPLICATE" | "SUCCESS";

/** Staff scans a member's own QR code (camera scanner at the front desk). */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "staff") {
    return NextResponse.json({ result: "UNAUTHENTICATED" as ResultCode }, { status: 401 });
  }

  const db = tenantDb(session.gymId);
  const [gym, staff] = await Promise.all([
    db.gym.findUnique({ where: { id: session.gymId } }),
    db.staffUser.findUnique({ where: { id: session.staffUserId }, select: { isActive: true, gymId: true } }),
  ]);
  if (!gym || !staff || !staff.isActive || staff.gymId !== gym.id) {
    return NextResponse.json({ result: "UNAUTHENTICATED" as ResultCode }, { status: 401 });
  }
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json({ result: "GYM_SUSPENDED" as ResultCode }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = checkinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ result: "MALFORMED" as ResultCode }, { status: 400 });
  }

  if (isTicketToken(parsed.data.token)) {
    return handleTicketScan(db, gym, session.staffUserId, parsed.data.token);
  }

  const unverifiedPayload = parseQrToken(parsed.data.token);
  if (!unverifiedPayload) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  // Cross-tenant rejection: the QR's embedded gymId must match the scanning staff's own gym,
  // checked BEFORE we trust anything else about the token.
  if (unverifiedPayload.gymId !== session.gymId) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  const member = await db.member.findUnique({ where: { id: unverifiedPayload.memberId } });
  if (!member || member.gymId !== session.gymId) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  const verified = verifyQrToken(parsed.data.token, member.qrSecret);
  if (!verified) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  const outcome = await evaluateAndLogCheckin(db, member, gym, session.staffUserId);
  return NextResponse.json({ result: outcome.result as ResultCode, message: outcome.message, member: outcome.memberSummary });
}

type TicketReply = { result: ResultCode; message?: string; member?: { fullName: string; photoUrl: string | null } };

/**
 * Staff scans a guest's one-time ticket (class or day pass). Same gates as a member scan (right gym, valid
 * signature), then the pass flips APPROVED → ATTENDED in a single compare-and-set so a second scan
 * — or two scanners at once — can never admit the same ticket twice. Guests aren't members, so
 * nothing is written to CheckIn.
 */
async function handleTicketScan(db: ReturnType<typeof tenantDb>, gym: { id: string; timezone: string }, staffUserId: string, token: string) {
  const gymId = gym.id;
  const reply = (body: TicketReply, status = 200) => NextResponse.json(body, { status });

  const unverified = parseTicketToken(token);
  // Cross-tenant rejection before anything else is trusted.
  if (!unverified || unverified.gymId !== gymId) return reply({ result: "INVALID" });

  const pass = await db.guestPass.findUnique({
    where: { id: unverified.passId },
    include: { session: { include: { class: true } }, dayPassPlan: true },
  });
  if (!pass) return handleBookingScan(db, gym, staffUserId, token, unverified.passId);
  if (pass.gymId !== gymId || !verifyTicketToken(token, pass.ticketSecret)) return reply({ result: "INVALID" });

  const who = { fullName: pass.fullName, photoUrl: null };
  if (pass.status === "ATTENDED") return reply({ result: "DUPLICATE", message: "Ticket already used", member: who });
  if (pass.status !== "APPROVED") return reply({ result: "INVALID", message: "Ticket not approved", member: who });
  if (passIsCancelled(pass)) return reply({ result: "EXPIRED", message: "Class was cancelled", member: who });

  const window = passWindow(pass, gym.timezone);
  const isClass = Boolean(pass.session);
  if (window === "EARLY") return reply({ result: "INVALID", message: isClass ? "Too early — class isn't open yet" : "Too early — pass is for a later day", member: who });
  if (window === "OVER") return reply({ result: "EXPIRED", message: isClass ? "Class has ended" : "Day pass has expired", member: who });

  const res = await db.guestPass.updateMany({
    where: { id: pass.id, gymId, status: "APPROVED" },
    data: { status: "ATTENDED", attendedAt: new Date(), scannedById: staffUserId },
  });
  if (res.count !== 1) return reply({ result: "DUPLICATE", message: "Ticket already used", member: who });
  return reply({ result: "SUCCESS", message: `${isClass ? "Class ticket" : "Ticket"}: ${passTitle(pass)}`, member: who });
}

/**
 * Staff scans a field booking's ticket. Same gates as a guest ticket (right gym, valid signature), then the
 * booking flips APPROVED to ATTENDED in one compare-and-set. The scan only records that they came: the booking
 * already holds its time from the moment staff approved it, whether or not anyone scans.
 */
async function handleBookingScan(db: ReturnType<typeof tenantDb>, gym: { id: string; timezone: string }, staffUserId: string, token: string, bookingId: string) {
  const gymId = gym.id;
  const reply = (body: TicketReply, status = 200) => NextResponse.json(body, { status });

  const booking = await db.fieldBooking.findUnique({ where: { id: bookingId }, include: { field: true } });
  if (!booking || booking.gymId !== gymId || booking.isBlock || !verifyTicketToken(token, booking.ticketSecret)) return reply({ result: "INVALID" });

  const who = { fullName: booking.fullName, photoUrl: null };
  if (booking.status === "ATTENDED") return reply({ result: "DUPLICATE", message: "Booking already checked in", member: who });
  if (booking.status !== "APPROVED") return reply({ result: "INVALID", message: "Booking not approved", member: who });

  const window = bookingWindow(booking);
  if (window === "EARLY") return reply({ result: "INVALID", message: "Too early for this booking", member: who });
  if (window === "OVER") return reply({ result: "EXPIRED", message: "This booking is over", member: who });

  const res = await db.fieldBooking.updateMany({
    where: { id: booking.id, gymId, status: "APPROVED" },
    data: { status: "ATTENDED", attendedAt: new Date(), scannedById: staffUserId },
  });
  if (res.count !== 1) return reply({ result: "DUPLICATE", message: "Booking already checked in", member: who });
  return reply({ result: "SUCCESS", message: `${booking.field.name}: ${bookingWhen(booking, gym.timezone)}`, member: who });
}
