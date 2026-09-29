import { NextRequest, NextResponse } from "next/server";
import { tenantTransaction } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { confirmClassRegistrationSchema } from "@/lib/validation/tenant";
import { sendClassConfirmation } from "@/lib/classes";

/**
 * Owner or staff confirms a member's class registration by recording what they paid at the front
 * desk (cash or bank transfer) — the manual counterpart of the online-payment webhook. Same shape
 * as recording a manual membership payment.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string; registrationId: string } }) {
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

  const parsed = confirmClassRegistrationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the amount and try again." }, { status: 400 });
  const d = parsed.data;

  // Tenant isolation: the registration must belong to the session's gym.
  const reg = await db.classRegistration.findUnique({
    where: { id: params.registrationId },
    include: { payment: true, session: { include: { class: true } } },
  });
  if (!reg || reg.gymId !== gym.id) return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  if (reg.status === "CONFIRMED") return NextResponse.json({ error: "This registration is already confirmed." }, { status: 409 });
  if (reg.status === "CANCELLED") return NextResponse.json({ error: "This registration was cancelled." }, { status: 409 });
  if (reg.session.status !== "SCHEDULED") return NextResponse.json({ error: "This session is no longer scheduled." }, { status: 409 });
  if (reg.payment?.status === "PAID") return NextResponse.json({ error: "This registration is already paid." }, { status: 409 });

  const paidAt = new Date();
  await tenantTransaction(gym.id, async (tx) => {
    // An unpaid online invoice, if any, is replaced by the cash record (the invoice is left to expire).
    if (reg.payment) await tx.classPayment.delete({ where: { id: reg.payment.id } });
    await tx.classPayment.create({
      data: {
        gymId: gym.id,
        registrationId: reg.id,
        provider: "CASH",
        amount: d.amount,
        currency: reg.session.class.currency,
        status: "PAID",
        paidAt,
        note: d.note || null,
        recordedById: session.staffUserId,
      },
    });
    await tx.classRegistration.update({ where: { id: reg.id }, data: { status: "CONFIRMED" } });
  });

  await sendClassConfirmation(reg.id);
  return NextResponse.json({ ok: true });
}
