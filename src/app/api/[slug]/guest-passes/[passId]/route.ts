import { NextRequest, NextResponse } from "next/server";
import { tenantTransaction } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { guestPassActionSchema } from "@/lib/validation/tenant";
import { countSeatsTaken, effectiveCapacity } from "@/lib/classes";
import { dayPassExpiry, passIsCancelled, passWindow, sendGuestRejection, sendGuestTicket } from "@/lib/guestPass";

class FullError extends Error {}
class StateError extends Error {}

/**
 * Owner or staff decides on a guest's request (class spot or day pass). Approve → seat held, one-time ticket link sent over
 * WhatsApp. Reject → guest told. Resend → same ticket link again (approved, not yet used).
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
  const { action } = parsed.data;

  // Tenant isolation: the pass must belong to the session's gym.
  const pass = await db.guestPass.findUnique({ where: { id: params.passId }, include: { session: { include: { class: true } }, dayPassPlan: true } });
  if (!pass || pass.gymId !== gym.id) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  if (action === "resend") {
    if (pass.status !== "APPROVED") return NextResponse.json({ error: "Only an approved, unused ticket can be re-sent." }, { status: 409 });
    await sendGuestTicket(pass.id);
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
