import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import { requireTenantSession, SessionError } from "@/lib/session";
import { deleteBlob } from "@/lib/blob";
import { fieldBookingActionSchema } from "@/lib/validation/tenant";
import { bookingAmount, bookingMinutes, bookingWindow } from "@/lib/fieldBooking";
import { tenantTransaction } from "@/lib/prisma";
import { HOLDING, balance, isOverlapError, paidByBooking, sendBookingApproved, sendBookingCancelled, sendBookingRejected } from "@/lib/fieldBookings";
import { channelProblem } from "@/lib/notify";
import { featureOff, gymHasFeature } from "@/lib/features";

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
  const { action, channel, pax, amount: asked } = parsed.data;

  // Tenant isolation: the booking must belong to the session's gym.
  const booking = await db.fieldBooking.findUnique({ where: { id: params.bookingId } });
  if (!booking || booking.gymId !== gym.id) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  const now = new Date();
  const window = bookingWindow(booking, now);
  const paidSoFar = (await paidByBooking(db, [booking.id])).get(booking.id) ?? 0;
  const paid = paidSoFar > 0;

  if (action === "approve") {
    // Taking new bookings needs the feature; managing ones already made (cancel, attend, resend) always works.
    if (!gymHasFeature(gym, "fieldBooking")) return featureOff("fieldBooking");
    if (booking.status !== "PENDING_REVIEW") return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });
    if (window === "OVER") return NextResponse.json({ error: "That time has already passed." }, { status: 409 });
    const clash = await db.fieldBooking.findFirst({
      where: { fieldId: booking.fieldId, status: { in: HOLDING }, startsAt: { lt: booking.endsAt }, endsAt: { gt: booking.startsAt } },
      select: { id: true },
    });
    if (clash) return NextResponse.json({ error: TAKEN }, { status: 409 });
    try {
      // Approving is staff confirming the money arrived, so the booking and its payment entry are written together.
      const done = await tenantTransaction(gym.id, async (tx) => {
        const res = await tx.fieldBooking.updateMany({
          where: { id: booking.id, gymId: gym.id, status: "PENDING_REVIEW" },
          data: { status: "APPROVED", reviewedAt: now, reviewedById: session.staffUserId },
        });
        if (res.count !== 1) return false;
        if (Number(booking.amount) > 0) {
          await tx.fieldBookingPayment.create({ data: { gymId: gym.id, bookingId: booking.id, amount: booking.amount, kind: "PAYMENT", recordedById: session.staffUserId } });
        }
        return true;
      });
      if (!done) return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });
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

  if (action === "edit_pax") {
    if (!["PENDING_REVIEW", "APPROVED", "ATTENDED"].includes(booking.status)) return NextResponse.json({ error: "The number of people can't be changed on this booking." }, { status: 409 });
    if (booking.pax === null || booking.rate === null) return NextResponse.json({ error: "This booking isn't priced per person." }, { status: 409 });
    if (pax === undefined) return NextResponse.json({ error: "Enter how many people." }, { status: 400 });
    const newAmount = bookingAmount("PER_PAX", Number(booking.rate), pax, bookingMinutes(booking));
    const res = await db.fieldBooking.updateMany({
      where: { id: booking.id, gymId: gym.id, status: { in: ["PENDING_REVIEW", "APPROVED", "ATTENDED"] } },
      data: { pax, amount: newAmount },
    });
    if (res.count !== 1) return NextResponse.json({ error: "This booking was already changed." }, { status: 409 });
    return NextResponse.json({ ok: true, amount: newAmount, paid: paidSoFar, balance: balance(newAmount, paidSoFar) });
  }

  if (action === "collect" || action === "refund") {
    if (!["APPROVED", "ATTENDED", "NO_SHOW"].includes(booking.status)) return NextResponse.json({ error: "Only an approved booking has a balance." }, { status: 409 });
    const owing = balance(Number(booking.amount), paidSoFar);
    if (action === "collect") {
      if (owing <= 0) return NextResponse.json({ error: "Nothing is owed on this booking." }, { status: 409 });
      const take = asked ?? owing;
      if (take > owing) return NextResponse.json({ error: `Only Rp ${owing.toLocaleString("id-ID")} is owed.` }, { status: 400 });
      await db.fieldBookingPayment.create({ data: { gymId: gym.id, bookingId: booking.id, amount: take, kind: "COLLECTION", recordedById: session.staffUserId } });
      return NextResponse.json({ ok: true, balance: owing - take });
    }
    // Giving money back is a money action, like cancelling a paid booking: owner only.
    if (session.role !== "OWNER") return NextResponse.json({ error: "Only the owner can record a refund." }, { status: 403 });
    if (owing >= 0) return NextResponse.json({ error: "Nothing is owed back on this booking." }, { status: 409 });
    const give = asked ?? -owing;
    if (give > -owing) return NextResponse.json({ error: `Only Rp ${(-owing).toLocaleString("id-ID")} is owed back.` }, { status: 400 });
    await db.fieldBookingPayment.create({ data: { gymId: gym.id, bookingId: booking.id, amount: -give, kind: "REFUND", recordedById: session.staffUserId } });
    return NextResponse.json({ ok: true, balance: owing + give });
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
  const paidSoFar = (await paidByBooking(db, [booking.id])).get(booking.id) ?? 0;
  const entries = await db.fieldBookingPayment.count({ where: { bookingId: booking.id } });
  // Anything that took money, even if it was later refunded, is part of the books: cancel it instead of deleting it.
  if (!booking.isBlock && (paidSoFar > 0 || entries > 0)) return NextResponse.json({ error: "A booking that took payment can't be deleted. Cancel it instead." }, { status: 409 });

  await db.fieldBooking.delete({ where: { id: booking.id } });
  if (booking.proofImageUrl) await deleteBlob(booking.proofImageUrl).catch(() => {});
  return NextResponse.json({ ok: true });
}
