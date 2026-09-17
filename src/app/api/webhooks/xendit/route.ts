import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyXenditCallback, type XenditWebhookEvent } from "@/lib/xendit";

export async function POST(req: NextRequest) {
  const headerToken = req.headers.get("x-callback-token");
  if (!verifyXenditCallback(headerToken)) {
    return NextResponse.json({ error: "Invalid callback token" }, { status: 401 });
  }

  const event = (await req.json().catch(() => null)) as XenditWebhookEvent | null;
  if (!event || !event.external_id || !event.status) {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  const memberPayment = await prisma.payment.findUnique({
    where: { id: event.external_id },
    include: { plan: true },
  });

  if (memberPayment) {
    await handleMemberPayment(memberPayment, event);
    return NextResponse.json({ ok: true });
  }

  const platformPayment = await prisma.platformPayment.findUnique({
    where: { id: event.external_id },
    include: { saasPlan: true },
  });

  if (platformPayment) {
    await handlePlatformPayment(platformPayment, event);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown external_id" }, { status: 404 });
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
        data: { status: "ACTIVE", membershipExpiry: newExpiry },
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
