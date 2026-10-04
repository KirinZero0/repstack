import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

/** Records that a gym's outstanding setup fee was settled outside the app. Idempotent: a second call finds nothing pending. */
export async function POST(_req: Request, { params }: { params: { gymId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId } });
  if (!gym) {
    return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  }

  const pending = await prisma.platformPayment.findFirst({
    where: { gymId: gym.id, kind: "SETUP", status: "PENDING" },
  });
  if (!pending) {
    return NextResponse.json({ error: "No unpaid setup fee for this gym" }, { status: 409 });
  }

  const paidAt = new Date();
  // Status is part of the filter so a concurrent second click can't re-stamp paidAt.
  const { count } = await prisma.platformPayment.updateMany({
    where: { id: pending.id, status: "PENDING" },
    data: { status: "PAID", paidAt },
  });
  if (count === 0) {
    return NextResponse.json({ error: "No unpaid setup fee for this gym" }, { status: 409 });
  }

  await writeAuditLog({
    superadminId: session.superadminId,
    gymId: gym.id,
    action: "SETUP_FEE_PAID",
    metadata: { platformPaymentId: pending.id, amount: Number(pending.amount) },
  });

  return NextResponse.json({ ok: true, paidAt });
}
