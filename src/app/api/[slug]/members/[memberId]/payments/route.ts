import { NextRequest, NextResponse } from "next/server";
import { tenantTransaction } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { recordPaymentSchema } from "@/lib/validation/tenant";
import { extendedExpiry } from "@/lib/payments";
import { dayKeyInTimezone } from "@/lib/date";
import { decrypt } from "@/lib/crypto";
import { sendGymWhatsapp } from "@/lib/whatsapp";

/** Owner or staff records money a member paid in person (cash, bank transfer) and activates them. */
export async function POST(req: NextRequest, { params }: { params: { slug: string; memberId: string } }) {
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

  const parsed = recordPaymentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the amount, plan and date and try again." }, { status: 400 });
  }
  const d = parsed.data;

  // Tenant isolation: member and plan must both belong to the session's gym.
  const [member, plan] = await Promise.all([
    db.member.findUnique({ where: { id: params.memberId } }),
    db.membershipPlan.findUnique({ where: { id: d.planId } }),
  ]);
  if (!member || member.gymId !== gym.id) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (!plan || plan.gymId !== gym.id) return NextResponse.json({ error: "That plan isn't available" }, { status: 400 });
  if (member.status === "CANCELLED") {
    return NextResponse.json({ error: "This membership was cancelled and can't take payments." }, { status: 409 });
  }

  const now = new Date();
  const todayKey = dayKeyInTimezone(now, gym.timezone);
  if (d.paidOn && d.paidOn > todayKey) {
    return NextResponse.json({ error: "The payment date can't be in the future." }, { status: 400 });
  }
  const paidAt = !d.paidOn || d.paidOn === todayKey ? now : new Date(`${d.paidOn}T12:00:00Z`);

  // Guard against a double-click or a repeated submit creating the same entry twice.
  const dupe = await db.payment.findFirst({
    where: {
      memberId: member.id,
      provider: "CASH",
      planId: plan.id,
      amount: d.amount,
      createdAt: { gte: new Date(now.getTime() - 60_000) },
    },
  });
  if (dupe) {
    return NextResponse.json({ error: "This exact payment was just recorded. Refresh to see it." }, { status: 409 });
  }

  const newExpiry = extendedExpiry(member.membershipExpiry, plan.durationDays, paidAt);

  // Both writes succeed or neither does, still confined to this gym.
  const payment = await tenantTransaction(gym.id, async (tx) => {
    const created = await tx.payment.create({
      data: {
        gymId: gym.id,
        memberId: member.id,
        planId: plan.id,
        provider: "CASH",
        amount: d.amount,
        currency: plan.currency,
        status: "PAID",
        paidAt,
        note: d.note || null,
        recordedById: session.staffUserId,
      },
    });
    await tx.member.update({
      where: { id: member.id },
      data: {
        planId: plan.id,
        membershipExpiry: newExpiry,
        // A frozen member stays frozen; everyone else is active if the new expiry is still ahead.
        ...(member.status === "FROZEN" ? {} : { status: newExpiry > now ? "ACTIVE" : "EXPIRED" }),
      },
    });
    return created;
  });

  await sendGymWhatsapp(gym.id, {
    to: decrypt(member.phoneWhatsapp),
    message: `Hi ${member.fullName}, we received your payment of Rp ${d.amount.toLocaleString("id-ID")} for ${plan.name} at ${gym.name}. Your membership is active until ${newExpiry.toLocaleDateString("id-ID", { timeZone: gym.timezone })}. Thank you!`,
    type: "payment_receipt",
    memberId: member.id,
  }).catch((err) => console.error("Payment receipt failed", err));

  return NextResponse.json({ paymentId: payment.id, membershipExpiry: newExpiry.toISOString() }, { status: 201 });
}
