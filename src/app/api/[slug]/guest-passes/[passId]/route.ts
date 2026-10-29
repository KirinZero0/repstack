import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { tenantTransaction } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { tenantOrResponse } from "@/lib/routeAuth";
import { deleteBlob } from "@/lib/blob";
import { guestPassActionSchema } from "@/lib/validation/tenant";
import { countSeatsTaken, effectiveCapacity } from "@/lib/classes";
import { dayPassExpiry, passIsCancelled, passWindow, sendGuestRejection, sendGuestTicket } from "@/lib/guestPass";
import { channelProblem } from "@/lib/notify";

class FullError extends Error {}
class StateError extends Error {}

/**
 * Owner or staff decides on a guest's request (class spot or day pass). Approve → seat held, one-time ticket link sent over
 * WhatsApp and by email (if the guest left one). Reject → guest told. Resend → same ticket link again, on the channel
 * staff picked, while the ticket can still be used (approved, not used, not expired or cancelled).
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string; passId: string } }) {
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

  const parsed = guestPassActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { action, channel } = parsed.data;

  // Tenant isolation: the pass must belong to the session's gym.
  const pass = await db.guestPass.findUnique({ where: { id: params.passId }, include: { session: { include: { class: true } }, dayPassPlan: true } });
  if (!pass || pass.gymId !== gym.id) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  if (action === "void") {
    // Taking back a ticket someone already paid for is a money action, like voiding a payment: owner only.
    if (session.role !== "OWNER") return NextResponse.json({ error: "Only the owner can void a paid ticket" }, { status: 403 });
    if (pass.status !== "APPROVED" && pass.status !== "ATTENDED") {
      return NextResponse.json({ error: "Only an approved or used ticket can be voided." }, { status: 409 });
    }
    // A new secret kills the ticket link and QR at once; the record stays, but it no longer counts as revenue or holds a seat.
    const res = await db.guestPass.updateMany({
      where: { id: pass.id, gymId: gym.id, status: { in: ["APPROVED", "ATTENDED"] } },
      data: { status: "VOIDED", ticketSecret: randomUUID() },
    });
    if (res.count !== 1) return NextResponse.json({ error: "This ticket was already changed." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (action === "resend") {
    if (pass.status !== "APPROVED") return NextResponse.json({ error: "Only an approved, unused ticket can be re-sent." }, { status: 409 });
    if (passIsCancelled(pass) || passWindow(pass, gym.timezone) === "OVER") {
      return NextResponse.json({ error: pass.session ? "That session is cancelled or over, so the ticket can't be used." : "This day pass has expired, so the ticket can't be used." }, { status: 409 });
    }
    if (channel === "email" && !pass.email) return NextResponse.json({ error: "This guest didn't leave an email. Send it on WhatsApp instead." }, { status: 409 });
    const result = await sendGuestTicket(pass.id, channel ?? "whatsapp");
    const problem = channelProblem(result, channel ?? "whatsapp");
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (pass.status !== "PENDING_REVIEW") return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });
  if (action === "approve" && (passIsCancelled(pass) || passWindow(pass, gym.timezone) === "OVER")) {
    return NextResponse.json({ error: pass.session ? "That session is cancelled or over." : "That day pass has expired." }, { status: 409 });
  }

  try {
    await tenantTransaction(gym.id, async (tx) => {
      // Only class passes hold a seat; a day pass has no capacity.
      if (action === "approve" && pass.session && pass.sessionId) {
        const cap = effectiveCapacity(pass.session, pass.session.class);
        if (cap !== null && (await countSeatsTaken(tx, pass.sessionId)) >= cap) throw new FullError();
      }
      // Compare-and-set on the status so two staff clicking at once can't both decide.
      const res = await tx.guestPass.updateMany({
        where: { id: pass.id, gymId: gym.id, status: "PENDING_REVIEW" },
        data: {
          status: action === "approve" ? "APPROVED" : "REJECTED",
          reviewedById: session.staffUserId,
          reviewedAt: new Date(),
          // A flexible day pass starts its clock when staff approve it.
          ...(action === "approve" && pass.dayPassPlan && !pass.visitDate ? { expiresAt: dayPassExpiry(pass.dayPassPlan) } : {}),
        },
      });
      if (res.count !== 1) throw new StateError();
    });
  } catch (err) {
    if (err instanceof FullError) return NextResponse.json({ error: "This session is full." }, { status: 409 });
    if (err instanceof StateError) return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });
    throw err;
  }

  if (action === "approve") await sendGuestTicket(pass.id);
  else await sendGuestRejection(pass.id);
  return NextResponse.json({ ok: true });
}

/**
 * Owner or staff deletes a guest request or ticket made by mistake (a typo, a duplicate, a walk-in
 * logged on the wrong plan). Anything that took money (approved or used, with a price) is part of the
 * books and has to be voided instead, which keeps the record.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; passId: string } }) {
  const auth = await tenantOrResponse(params.slug);
  if ("response" in auth) return auth.response;
  const { gym, db } = auth.ctx;

  // Tenant isolation: the pass must belong to the session's gym.
  const pass = await db.guestPass.findUnique({ where: { id: params.passId } });
  if (!pass || pass.gymId !== gym.id) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const tookMoney = (pass.status === "APPROVED" || pass.status === "ATTENDED") && Number(pass.amount ?? 0) > 0;
  if (tookMoney || pass.status === "VOIDED") {
    return NextResponse.json({ error: "This ticket was paid for, so it can't be deleted. The owner can void it instead." }, { status: 409 });
  }

  await db.guestPass.delete({ where: { id: pass.id } });
  if (pass.proofImageUrl) await deleteBlob(pass.proofImageUrl);
  return NextResponse.json({ ok: true });
}
