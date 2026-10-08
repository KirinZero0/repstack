import { NextRequest, NextResponse } from "next/server";
import { tenantTransaction } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { addClassRegistrationSchema } from "@/lib/validation/tenant";
import { countSeatsTaken, effectiveCapacity, sendClassConfirmation } from "@/lib/classes";

class FullError extends Error {}

/**
 * Owner or staff books a member into a session. Free class → confirmed at once; otherwise a
 * pending registration the front desk confirms with "Record payment". A member's earlier
 * cancelled booking is reused.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string; sessionId: string } }) {
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

  const parsed = addClassRegistrationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a member." }, { status: 400 });

  // Tenant isolation: session and member must both belong to the session's gym.
  const cs = await db.classSession.findUnique({ where: { id: params.sessionId }, include: { class: true } });
  if (!cs || cs.gymId !== gym.id) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (cs.status !== "SCHEDULED") return NextResponse.json({ error: "This session is cancelled or over." }, { status: 409 });

  const member = await db.member.findUnique({ where: { id: parsed.data.memberId } });
  if (!member || member.gymId !== gym.id || member.anonymizedAt) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (member.status === "CANCELLED") return NextResponse.json({ error: "This membership was cancelled." }, { status: 409 });

  const existing = await db.classRegistration.findUnique({
    where: { sessionId_memberId: { sessionId: cs.id, memberId: member.id } },
    include: { payment: true },
  });
  if (existing && existing.status !== "CANCELLED") {
    return NextResponse.json({ error: `${member.fullName} is already on this session.` }, { status: 409 });
  }

  const status = Number(cs.class.price) === 0 || existing?.payment?.status === "PAID" ? "CONFIRMED" : "PENDING_PAYMENT";
  let regId: string;
  try {
    regId = await tenantTransaction(gym.id, async (tx) => {
      const cap = effectiveCapacity(cs, cs.class);
      if (cap !== null && (await countSeatsTaken(tx, cs.id)) >= cap) throw new FullError();
      if (existing) {
        if (existing.payment && existing.payment.status !== "PAID") await tx.classPayment.delete({ where: { id: existing.payment.id } });
        await tx.classRegistration.update({ where: { id: existing.id }, data: { status, createdAt: new Date(), attendance: null, attendanceAt: null } });
        return existing.id;
      }
      const reg = await tx.classRegistration.create({ data: { gymId: gym.id, sessionId: cs.id, memberId: member.id, status } });
      return reg.id;
    });
  } catch (err) {
    if (err instanceof FullError) return NextResponse.json({ error: "This session is full." }, { status: 409 });
    throw err;
  }

  if (status === "CONFIRMED") await sendClassConfirmation(regId);
  return NextResponse.json({ ok: true, registrationId: regId, status }, { status: 201 });
}
