import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { onlinePaymentsEnabled } from "@/lib/gateway";
import { openPlatformInvoice } from "@/lib/platformBilling";
import { withSuspensionReason } from "@/lib/suspension";
import { sendPlatformWhatsapp } from "@/lib/whatsapp";

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Online payments are off: don't create renewal invoices nobody can pay, and don't suspend
  // gyms for non-payment when they have no way to pay their way out.
  if (!onlinePaymentsEnabled()) {
    return NextResponse.json({ invoicesCreated: 0, gymsSuspended: 0, paymentsDisabled: true });
  }

  const now = new Date();

  const dueGyms = await prisma.gym.findMany({
    where: {
      isLifetime: false,
      nextBillingDate: { lte: now },
      subscriptionStatus: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
    },
    include: { saasPlan: true, staff: { where: { role: "OWNER" } } },
  });

  let invoicesCreated = 0;
  for (const gym of dueGyms) {
    try {
      // Reuses the gym's open invoice if it's still live, so a gym that hasn't paid isn't sent a new one every day.
      const { url, created } = await openPlatformInvoice(gym, gym.saasPlan, "renewal");
      if (gym.subscriptionStatus !== "PAST_DUE") {
        await prisma.gym.update({ where: { id: gym.id }, data: { subscriptionStatus: "PAST_DUE" } });
      }
      if (!created) continue;

      const owner = gym.staff[0];
      if (owner?.phone) {
        await sendPlatformWhatsapp({
          to: owner.phone,
          message: `Your Repstack subscription for "${gym.name}" is due. Pay here: ${url.startsWith("/") ? `${process.env.NEXT_PUBLIC_APP_URL}${url}` : url}`,
        });
      }
      invoicesCreated++;
    } catch (err) {
      console.error(`Failed to create renewal invoice for gym ${gym.id}`, err);
    }
  }

  // Grace period over: suspend, and remember why so the owner can still get in to pay.
  const pastDueGyms = await prisma.gym.findMany({
    where: { subscriptionStatus: "PAST_DUE", isLifetime: false },
  });
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_MS);
  const toSuspend = pastDueGyms.filter((g) => g.nextBillingDate && g.nextBillingDate < cutoff);
  for (const g of toSuspend) {
    await prisma.gym.update({
      where: { id: g.id },
      data: { subscriptionStatus: "SUSPENDED", settings: withSuspensionReason(g.settings, "non_payment") },
    });
  }

  return NextResponse.json({
    invoicesCreated,
    gymsSuspended: toSuspend.length,
  });
}
