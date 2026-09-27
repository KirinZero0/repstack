import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { payMembershipSchema } from "@/lib/validation/tenant";
import { createInvoice, getInvoiceState, paymentProviderEnum } from "@/lib/gateway";

/** A member starts (or resumes) paying for a membership plan; returns the hosted invoice URL. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    return NextResponse.json({ error: "Log in as a member to pay" }, { status: 401 });
  }

  const db = tenantDb(session.gymId);
  const parsed = payMembershipSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const [member, gym] = await Promise.all([
    db.member.findUnique({ where: { id: session.memberId } }),
    db.gym.findUnique({ where: { id: session.gymId } }),
  ]);
  if (!member || !gym || member.gymId !== gym.id || member.anonymizedAt) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json({ error: "This gym can't take payments right now" }, { status: 403 });
  }
  if (member.status === "CANCELLED") {
    return NextResponse.json({ error: "This membership was cancelled. Ask the gym to reactivate it." }, { status: 403 });
  }

  // Tenant isolation: only plans that belong to the member's own gym, and are on sale.
  const plan = await db.membershipPlan.findUnique({ where: { id: parsed.data.planId } });
  if (!plan || plan.gymId !== gym.id || !plan.isActive) {
    return NextResponse.json({ error: "That plan isn't available" }, { status: 400 });
  }

  try {
    // Resume an unpaid invoice for the same plan instead of stacking duplicates.
    const pending = await db.payment.findFirst({
      where: { memberId: member.id, planId: plan.id, status: "PENDING", externalInvoiceId: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (pending?.externalInvoiceId && pending.invoiceUrl) {
      const state = await getInvoiceState(pending.externalInvoiceId, pending.createdAt, pending.provider);
      if (state === "PENDING") return NextResponse.json({ invoiceUrl: pending.invoiceUrl });
    }

    const payment = await db.payment.create({
      data: {
        gymId: gym.id,
        memberId: member.id,
        planId: plan.id,
        provider: paymentProviderEnum(),
        amount: plan.price,
        currency: plan.currency,
        status: "PENDING",
      },
    });

    const invoice = await createInvoice({
      externalId: payment.id,
      amount: Number(plan.price),
      payerEmail: member.email,
      description: `${plan.name} membership — ${gym.name}`,
      currency: plan.currency,
      successRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/my`,
    });
    await db.payment.update({ where: { id: payment.id }, data: { externalInvoiceId: invoice.id, invoiceUrl: invoice.url } });

    return NextResponse.json({ invoiceUrl: invoice.url });
  } catch (err) {
    console.error("Membership payment failed to start", err);
    return NextResponse.json(
      { error: "We couldn't start the payment. Try again in a moment, or ask the gym to help." },
      { status: 502 },
    );
  }
}
