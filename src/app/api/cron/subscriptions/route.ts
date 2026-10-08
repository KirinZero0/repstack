import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { openPlatformInvoice } from "@/lib/platformBilling";
import { getPlatformBank, manualPlatformBilling } from "@/lib/platformBank";
import { withSuspensionReason } from "@/lib/suspension";
import { sendPlatformWhatsapp } from "@/lib/whatsapp";

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Bank-transfer mode (no online provider yet): owners pay by transfer and the superadmin confirms it, so the same
  // overdue and suspension rules apply. But a gym can only be held to them if it can see where to pay, so with no
  // bank account on file nothing is invoiced or suspended.
  if (manualPlatformBilling() && !(await getPlatformBank())) {
    return NextResponse.json({ invoicesCreated: 0, gymsSuspended: 0, bankNotConfigured: true });
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const manual = manualPlatformBilling();

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
        const payUrl = url.startsWith("/") ? `${appUrl}${url}` : url;
        // Same date the Billing page shows: suspension comes GRACE_PERIOD_MS after the due date.
        const graceEnds = new Date((gym.nextBillingDate ?? now).getTime() + GRACE_PERIOD_MS).toLocaleDateString("id-ID");
        await sendPlatformWhatsapp({
          to: owner.phone,
          message: manual
            ? `Your Liftmora subscription for "${gym.name}" is due. Pay by bank transfer and upload the proof here: ${payUrl}. Please pay before ${graceEnds}, or the gym will be suspended.`
            : `Your Liftmora subscription for "${gym.name}" is due. Pay here: ${payUrl}`,
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
    include: { staff: { where: { role: "OWNER" } } },
  });
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_MS);
  const toSuspend = pastDueGyms.filter((g) => g.nextBillingDate && g.nextBillingDate < cutoff);
  for (const g of toSuspend) {
    await prisma.gym.update({
      where: { id: g.id },
      data: { subscriptionStatus: "SUSPENDED", settings: withSuspensionReason(g.settings, "non_payment") },
    });
    const owner = g.staff[0];
    if (owner?.phone) {
      await sendPlatformWhatsapp({
        to: owner.phone,
        message: `Your Liftmora subscription for "${g.name}" was not paid, so the gym is suspended: staff and members can't log in or check in. Pay here to switch it back on right away: ${appUrl}/${g.slug}/billing`,
      });
    }
  }

  return NextResponse.json({
    invoicesCreated,
    gymsSuspended: toSuspend.length,
  });
}
