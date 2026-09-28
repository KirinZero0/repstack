import { NextResponse } from "next/server";
import { tenantTransaction } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Owner voids a manual payment entered by mistake: removes it from revenue and takes the days back. */
export async function POST(_req: Request, { params }: { params: { slug: string; memberId: string; paymentId: string } }) {
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
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can void a payment" }, { status: 403 });
  }

  const payment = await db.payment.findUnique({ where: { id: params.paymentId }, include: { plan: true } });
  if (!payment || payment.gymId !== gym.id || payment.memberId !== params.memberId) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }
  // Only manual entries can be voided here. Online payments are refunded through Xendit.
  if (payment.provider !== "CASH") {
    return NextResponse.json({ error: "Only manually recorded payments can be voided." }, { status: 409 });
  }
  if (payment.status !== "PAID") {
    return NextResponse.json({ error: "This payment was already voided." }, { status: 409 });
  }

  const member = await db.member.findUnique({ where: { id: payment.memberId } });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const reduced = member.membershipExpiry
    ? new Date(member.membershipExpiry.getTime() - payment.plan.durationDays * DAY_MS)
    : null;

  await tenantTransaction(gym.id, async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    await tx.member.update({
      where: { id: member.id },
      data: {
        membershipExpiry: reduced,
        ...(member.status === "ACTIVE" && (!reduced || reduced <= new Date()) ? { status: "EXPIRED" } : {}),
      },
    });
  });

  return NextResponse.json({ ok: true });
}
