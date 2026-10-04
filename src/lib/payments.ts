import { prisma } from "./prisma";
import type { XenditWebhookEvent } from "./xendit";
import { completeSignup } from "./signup";
import { suspendedForNonPayment, withSuspensionReason } from "./suspension";
import { extendedExpiry } from "./membership";

export { extendedExpiry };
import { completeMemberSignup } from "./memberSignup";
import { sendClassConfirmation } from "./classes";

/** Applies a payment event to a member, platform, signup, join or class payment. Idempotent. Returns which kind it matched, or null. */
export async function processPaymentEvent(event: XenditWebhookEvent): Promise<"member" | "platform" | "signup" | "join" | "class" | null> {
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

  const signup = await prisma.gymSignup.findUnique({ where: { id: event.external_id } });
  if (signup) {
    // Only a payment creates the gym; an expired/failed invoice leaves the signup pending and unused.
    if (event.status === "PAID") {
      await completeSignup(signup.id, {
        paidAt: event.paid_at ? new Date(event.paid_at) : new Date(),
        externalInvoiceId: signup.externalInvoiceId,
      });
    }
    return "signup";
  }

  const join = await prisma.memberSignup.findUnique({ where: { id: event.external_id } });
  if (join) {
    if (event.status === "PAID") {
      await completeMemberSignup(join.id, event.paid_at ? new Date(event.paid_at) : new Date());
    }
    return "join";
  }

  const classPayment = await prisma.classPayment.findUnique({ where: { id: event.external_id } });
  if (classPayment) {
    await handleClassPayment(classPayment, event);
    return "class";
  }

  return null;
}

async function handleClassPayment(payment: Awaited<ReturnType<typeof prisma.classPayment.findUniqueOrThrow>>, event: XenditWebhookEvent) {
  // Idempotency: a second delivery of the same event finds the payment already PAID/EXPIRED and does nothing.
  if (payment.status !== "PENDING") return;

  if (event.status === "PAID") {
    await prisma.$transaction([
      prisma.classPayment.update({
        where: { id: payment.id },
        data: { status: "PAID", paidAt: event.paid_at ? new Date(event.paid_at) : new Date() },
      }),
      // The seat was reserved at registration time, so a late payment keeps it — no second capacity check.
      prisma.classRegistration.update({ where: { id: payment.registrationId }, data: { status: "CONFIRMED" } }),
    ]);
    await sendClassConfirmation(payment.registrationId);
  } else if (event.status === "EXPIRED") {
    // The invoice lapsed: free the seat. The member can book again, which starts a fresh invoice.
    await prisma.$transaction([
      prisma.classPayment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } }),
      prisma.classRegistration.updateMany({ where: { id: payment.registrationId, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED" } }),
    ]);
  }
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

    const newExpiry = extendedExpiry(member.membershipExpiry, payment.plan.durationDays, new Date());

    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: "PAID", paidAt: event.paid_at ? new Date(event.paid_at) : new Date() },
      }),
      prisma.member.update({
        where: { id: member.id },
        // A frozen or cancelled member keeps that status (the owner decides when to lift it); the money still counts.
        data: {
          status: member.status === "FROZEN" || member.status === "CANCELLED" ? member.status : "ACTIVE",
          membershipExpiry: newExpiry,
          planId: payment.planId,
        },
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

  // A setup fee is a one-time charge: settle the record and leave the subscription alone.
  if (payment.kind === "SETUP") {
    if (event.status === "PAID") {
      await prisma.platformPayment.update({
        where: { id: payment.id },
        data: { status: "PAID", paidAt: event.paid_at ? new Date(event.paid_at) : new Date() },
      });
    } else if (event.status === "EXPIRED") {
      await prisma.platformPayment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
    }
    return;
  }

  if (event.status === "PAID") {
    const gym = await prisma.gym.findUnique({ where: { id: payment.gymId } });
    if (!gym) return;

    const days = payment.saasPlan.billingInterval === "annual" ? 365 : 30;
    const base = gym.nextBillingDate && gym.nextBillingDate > new Date() ? gym.nextBillingDate : new Date();
    const newBillingDate = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    // Paying reactivates a gym that was suspended for non-payment, but never one a superadmin suspended.
    const adminSuspended = gym.subscriptionStatus === "SUSPENDED" && !suspendedForNonPayment(gym.settings);

    await prisma.$transaction([
      prisma.platformPayment.update({
        where: { id: payment.id },
        data: { status: "PAID", paidAt: event.paid_at ? new Date(event.paid_at) : new Date() },
      }),
      prisma.gym.update({
        where: { id: gym.id },
        data: {
          nextBillingDate: newBillingDate,
          // The invoice's plan is the one being paid for: this is what switches the gym to a new plan after a plan change.
          saasPlanId: payment.saasPlanId,
          ...(adminSuspended ? {} : { subscriptionStatus: "ACTIVE", settings: withSuspensionReason(gym.settings, null) }),
        },
      }),
    ]);
  } else if (event.status === "EXPIRED") {
    await prisma.$transaction([
      prisma.platformPayment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } }),
      // Only a gym in good standing moves to past due; a suspended one must not be switched back on by an expiry.
      prisma.gym.updateMany({ where: { id: payment.gymId, subscriptionStatus: { in: ["ACTIVE", "TRIALING"] } }, data: { subscriptionStatus: "PAST_DUE" } }),
    ]);
  }
}
