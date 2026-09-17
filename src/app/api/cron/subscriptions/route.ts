import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { createXenditInvoice } from "@/lib/xendit";
import { sendPlatformWhatsapp } from "@/lib/whatsapp";

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const platformPayment = await prisma.platformPayment.create({
      data: {
        gymId: gym.id,
        saasPlanId: gym.saasPlanId,
        provider: "xendit",
        amount: gym.saasPlan.price,
        status: "PENDING",
      },
    });

    try {
      const invoice = await createXenditInvoice({
        externalId: platformPayment.id,
        amount: Number(gym.saasPlan.price),
        description: `${gym.saasPlan.name} — ${gym.name} subscription renewal`,
        currency: gym.saasPlan.currency,
      });
      await prisma.platformPayment.update({
        where: { id: platformPayment.id },
        data: { externalInvoiceId: invoice.id },
      });

      const owner = gym.staff[0];
      if (owner?.phone) {
        await sendPlatformWhatsapp({
          to: owner.phone,
          message: `Your Iron Ledger subscription for "${gym.name}" is due. Pay here: ${invoice.invoice_url}`,
        });
      }
      invoicesCreated++;
    } catch (err) {
      console.error(`Failed to create renewal invoice for gym ${gym.id}`, err);
    }
  }

  const pastDueGyms = await prisma.gym.findMany({
    where: { subscriptionStatus: "PAST_DUE" },
  });
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_MS);
  const toSuspend = pastDueGyms.filter((g) => g.nextBillingDate && g.nextBillingDate < cutoff);
  if (toSuspend.length > 0) {
    await prisma.gym.updateMany({
      where: { id: { in: toSuspend.map((g) => g.id) } },
      data: { subscriptionStatus: "SUSPENDED" },
    });
  }

  return NextResponse.json({
    invoicesCreated,
    gymsSuspended: toSuspend.length,
  });
}
