import { NextRequest, NextResponse } from "next/server";
import { tenantTransaction } from "@/lib/prisma";
import { tenantOrResponse } from "@/lib/routeAuth";

/**
 * Owner takes back a class payment recorded by mistake (wrong amount, wrong person): the payment is
 * voided (kept on record, out of revenue) and the booking goes back to "waiting for payment", so the
 * right amount can be recorded. Same rule as voiding a membership payment: manual entries only —
 * online payments are refunded through the payment provider.
 */
export async function POST(_req: NextRequest, { params }: { params: { slug: string; registrationId: string } }) {
  const auth = await tenantOrResponse(params.slug, { ownerOnly: "Only the owner can void a payment" });
  if ("response" in auth) return auth.response;
  const { gym, db } = auth.ctx;

  // Tenant isolation: the registration must belong to the session's gym.
  const reg = await db.classRegistration.findUnique({ where: { id: params.registrationId }, include: { payment: true } });
  if (!reg || reg.gymId !== gym.id) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (!reg.payment || reg.payment.status !== "PAID") return NextResponse.json({ error: "There's no payment to void on this booking." }, { status: 409 });
  if (reg.payment.provider !== "CASH") {
    return NextResponse.json({ error: "Only manually recorded payments can be voided. Refund online payments through the payment provider." }, { status: 409 });
  }

  await tenantTransaction(gym.id, async (tx) => {
    await tx.classPayment.update({ where: { id: reg.payment!.id }, data: { status: "FAILED" } });
    if (reg.status === "CONFIRMED") await tx.classRegistration.update({ where: { id: reg.id }, data: { status: "PENDING_PAYMENT" } });
  });
  return NextResponse.json({ ok: true });
}
