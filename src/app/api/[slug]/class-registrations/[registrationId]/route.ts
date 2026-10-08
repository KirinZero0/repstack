import { NextRequest, NextResponse } from "next/server";
import { tenantTransaction } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { expireRegistrationInvoice } from "@/lib/classes";

async function authorize(slug: string) {
  try {
    return { ok: true as const, ...(await requireTenantSession(slug)) };
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return { ok: false as const, res: NextResponse.json({ error: err.message }, { status }) };
    }
    throw err;
  }
}

/**
 * Owner or staff removes an unpaid booking in two steps: an unpaid, still-active registration is
 * first cancelled (frees the seat, expires any open invoice); a cancelled one can then be deleted
 * for good. A paid registration is never removed here — its money is on record.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; registrationId: string } }) {
  const auth = await authorize(params.slug);
  if (!auth.ok) return auth.res;
  const { gym, db } = auth;

  // Tenant isolation: the registration must belong to the session's gym.
  const reg = await db.classRegistration.findUnique({ where: { id: params.registrationId }, include: { payment: true } });
  if (!reg || reg.gymId !== gym.id) return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  if (reg.status === "CONFIRMED" || reg.payment?.status === "PAID") {
    return NextResponse.json({ error: "This booking is paid, so it can't be removed here." }, { status: 409 });
  }

  if (reg.status === "PENDING_PAYMENT") {
    await tenantTransaction(gym.id, async (tx) => {
      await tx.classRegistration.update({ where: { id: reg.id }, data: { status: "CANCELLED" } });
      if (reg.payment?.status === "PENDING") await tx.classPayment.update({ where: { id: reg.payment.id }, data: { status: "EXPIRED" } });
    });
    await expireRegistrationInvoice(reg.payment);
    return NextResponse.json({ ok: true, result: "cancelled" });
  }

  // Already cancelled and unpaid: delete it (and its dead payment record).
  await tenantTransaction(gym.id, async (tx) => {
    if (reg.payment) await tx.classPayment.delete({ where: { id: reg.payment.id } });
    await tx.classRegistration.delete({ where: { id: reg.id } });
  });
  return NextResponse.json({ ok: true, result: "deleted" });
}
