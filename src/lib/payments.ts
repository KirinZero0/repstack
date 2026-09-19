import { prisma } from "./prisma";
import type { XenditWebhookEvent } from "./xendit";

/** Applies a payment event to a member or platform payment. Idempotent. Returns which kind it matched, or null. */
export async function processPaymentEvent(event: XenditWebhookEvent): Promise<"member" | "platform" | null> {
  const memberPayment = await prisma.payment.findUnique({
    where: { id: event.external_id },
    include: { plan: true },
  });

  if (memberPayment) {
    await handleMemberPayment(memberPayment, event);
    return "member";
  }

  const platformPayment = await prisma.platformPayment.findUnique({
    where: { id: event.external_id },
    include: { saasPlan: true },
  });

  if (platformPayment) {
    await handlePlatformPayment(platformPayment, event);
    return "platform";
  }

  return null;
}

async function handleMemberPayment(
  payment: Awaited<ReturnType<typeof prisma.payment.findUniqueOrThrow>> & {
    plan: { durationDays: number };
  },
  event: XenditWebhookEvent,
) {
  // Idempotency: only mutate if this payment hasn't already been processed to a terminal state.
  if (payment.status !== "PENDING") return;

  if (event.status === "PAID") {
    const member = await prisma.member.findUnique({ where: { id: payment.memberId } });
    if (!member) return;

    const base =
      member.membershipExpiry && member.membershipExpiry > new Date()
        ? member.membershipExpiry
        : new Date();
    const newExpiry = new Date(base.getTime() + payment.plan.durationDays * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: "PAID", paidAt: event.paid_at ? new Date(event.paid_at) : new Date() },
      }),
      prisma.member.update({
        where: { id: member.id },
        data: { status: "ACTIVE", membershipExpiry: newExpiry, planId: payment.planId },
      }),
    ]);
  } else if (event.status === "EXPIRED") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
  }
}

async function handlePlatformPayment(
  payment: Awaited<ReturnType<typeof prisma.platformPayment.findUniqueOrThrow>> & {
    saasPlan: { billingInterval: string };
  },
  event: XenditWebhookEvent,
) {
  if (payment.status !== "PENDING") return;

  if (event.status === "PAID") {
    const gym = await prisma.gym.findUnique({ where: { id: payment.gymId } });
    if (!gym) return;

    const days = payment.saasPlan.billingInterval === "annual" ? 365 : 30;
    const base = gym.nextBillingDate && gym.nextBillingDate > new Date() ? gym.nextBillingDate : new Date();
    const newBillingDate = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.platformPayment.update({
        where: { id: payment.id },
        data: { status: "PAID", paidAt: event.paid_at ? new Date(event.paid_at) : new Date() },
      }),
      prisma.gym.update({
        where: { id: gym.id },
        data: { subscriptionStatus: "ACTIVE", nextBillingDate: newBillingDate },
      }),
    ]);
  } else if (event.status === "EXPIRED") {
    await prisma.$transaction([
      prisma.platformPayment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } }),
      prisma.gym.update({ where: { id: payment.gymId }, data: { subscriptionStatus: "PAST_DUE" } }),
    ]);
  }
}
