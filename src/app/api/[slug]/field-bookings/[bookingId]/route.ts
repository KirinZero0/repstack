import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import { requireTenantSession, SessionError } from "@/lib/session";
import { deleteBlob } from "@/lib/blob";
import { fieldBookingActionSchema } from "@/lib/validation/tenant";
import { bookingWindow } from "@/lib/fieldBooking";
import { HOLDING, isOverlapError, sendBookingApproved, sendBookingCancelled, sendBookingRejected } from "@/lib/fieldBookings";
import { channelProblem } from "@/lib/notify";

const TAKEN = "Another booking already holds this time. Decline this one, or cancel the other first.";

/**
 * Owner or staff acts on a field booking.
 * approve: the booking takes its time on the field (the database refuses it if another booking holds any of
 *   that time) and the guest gets their ticket. reject: the guest is told. cancel: an approved booking frees its
 *   time and the ticket stops working (owner only when money was paid). attend / noshow: set by hand what a scan
 *   would. resend: the ticket again, on the channel staff pick, while it can still be used.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string; bookingId: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }

  const parsed = fieldBookingActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { action, channel } = parsed.data;

  // Tenant isolation: the booking must belong to the session's gym.
  const booking = await db.fieldBooking.findUnique({ where: { id: params.bookingId } });
  if (!booking || booking.gymId !== gym.id) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  const now = new Date();
  const window = bookingWindow(booking, now);
  const paid = Number(booking.amount) > 0;

  if (action === "approve") {
    if (booking.status !== "PENDING_REVIEW") return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });
    if (window === "OVER") return NextResponse.json({ error: "That time has already passed." }, { status: 409 });
    const clash = await db.fieldBooking.findFirst({
      where: { fieldId: booking.fieldId, status: { in: HOLDING }, startsAt: { lt: booking.endsAt }, endsAt: { gt: booking.startsAt } },
      select: { id: true },
    });
    if (clash) return NextResponse.json({ error: TAKEN }, { status: 409 });
    try {
      const res = await db.fieldBooking.updateMany({
        where: { id: booking.id, gymId: gym.id, status: "PENDING_REVIEW" },
        data: { status: "APPROVED", reviewedAt: now, reviewedById: session.staffUserId },
      });
      if (res.count !== 1) return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });
    } catch (err) {
      // Two approvals at the same instant: the database lets exactly one through.
      if (isOverlapError(err)) return NextResponse.json({ error: TAKEN }, { status: 409 });
      throw err;
    }
    waitUntil(sendBookingApproved(booking.id));
    return NextResponse.json({ ok: true });
  }

  if (action === "reject") {
    const res = await db.fieldBooking.updateMany({
      where: { id: booking.id, gymId: gym.id, status: "PENDING_REVIEW" },
      data: { status: "REJECTED", reviewedAt: now, reviewedById: session.staffUserId },
    });
    if (res.count !== 1) return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });
    waitUntil(sendBookingRejected(booking.id));
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    if (booking.status !== "APPROVED") return NextResponse.json({ error: "Only an approved booking can be cancelled." }, { status: 409 });
    // Taking back a booking someone already paid for is a money action, like voiding a payment: owner only.
    if (paid && session.role !== "OWNER") return NextResponse.json({ error: "Only the owner can cancel a paid booking." }, { status: 403 });
    // A new secret kills the ticket at once; the record stays, but it no longer counts as revenue or holds the time.
    const res = await db.fieldBooking.updateMany({
      where: { id: booking.id, gymId: gym.id, status: "APPROVED" },
      data: { status: "CANCELLED", ticketSecret: randomUUID() },
    });
    if (res.count !== 1) return NextResponse.json({ error: "This booking was already changed." }, { status: 409 });
    waitUntil(sendBookingCancelled(booking.id, paid));
    return NextResponse.json({ ok: true });
  }

  if (action === "attend") {
    if (booking.status !== "APPROVED") return NextResponse.json({ error: "Only an approved booking can be marked attended." }, { status: 409 });
    if (window === "EARLY") return NextResponse.json({ error: "It's too early for this booking." }, { status: 409 });
    const res = await db.fieldBooking.updateMany({
      where: { id: booking.id, gymId: gym.id, status: "APPROVED" },
      data: { status: "ATTENDED", attendedAt: now, scannedById: session.staffUserId },
    });
    if (res.count !== 1) return NextResponse.json({ error: "This booking was already changed." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (action === "noshow") {
    if (booking.status !== "APPROVED") return NextResponse.json({ error: "Only an approved booking can be a no-show." }, { status: 409 });
    if (window !== "OVER") return NextResponse.json({ error: "A booking can only be a no-show once its time is over." }, { status: 409 });
    const res = await db.fieldBooking.updateMany({
      where: { id: booking.id, gymId: gym.id, status: "APPROVED" },
      data: { status: "NO_SHOW" },
    });
    if (res.count !== 1) return NextResponse.json({ error: "This booking was already changed." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  // resend
  if (booking.status !== "APPROVED" || booking.isBlock) return NextResponse.json({ error: "Only an approved, unused ticket can be sent again." }, { status: 409 });
  if (window === "OVER") return NextResponse.json({ error: "This booking is over, so the ticket can't be used." }, { status: 409 });
  if (channel === "email" && !booking.email) return NextResponse.json({ error: "This guest didn't leave an email. Send it on WhatsApp instead." }, { status: 409 });
  const result = await sendBookingApproved(booking.id, channel ?? "whatsapp");
  const problem = channelProblem(result, channel ?? "whatsapp");
  if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/**
 * Removes a mistake: a staff block, a declined or never-approved request, or a free booking. A booking that
 * took money is cancelled, never deleted, so the books keep matching.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; bookingId: string } }) {
  let gym, db;
  try {
    ({ gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
  const booking = await db.fieldBooking.findUnique({ where: { id: params.bookingId } });
  if (!booking || booking.gymId !== gym.id) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  const moneyTaken = Number(booking.amount) > 0 && ["APPROVED", "ATTENDED", "NO_SHOW"].includes(booking.status);
  if (moneyTaken && !booking.isBlock) return NextResponse.json({ error: "A paid booking can't be deleted. Cancel it instead." }, { status: 409 });
  if (booking.status === "CANCELLED" && Number(booking.amount) > 0) return NextResponse.json({ error: "A cancelled paid booking stays on record." }, { status: 409 });

  await db.fieldBooking.delete({ where: { id: booking.id } });
  if (booking.proofImageUrl) await deleteBlob(booking.proofImageUrl).catch(() => {});
  return NextResponse.json({ ok: true });
}
