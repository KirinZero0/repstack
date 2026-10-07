import { prisma } from "./prisma";
import {
  createInvoice,
  expireInvoice,
  getInvoiceState,
  isMockMode,
  onlinePaymentsEnabled,
  PaymentsDisabledError,
  platformProviderName,
} from "./gateway";
import { manualPlatformBilling } from "./platformBank";

export { PaymentsDisabledError };

interface BillableGym {
  id: string;
  slug: string;
  name: string;
}
interface BillablePlan {
  id: string;
  name: string;
  price: unknown;
  currency: string;
}

/** Stops every unpaid subscription invoice of a gym, here and at the provider, so they can't be paid later. */
export async function retirePendingPlatformInvoices(gymId: string, exceptId?: string): Promise<void> {
  // Only subscription invoices: an unpaid setup fee is owed regardless of what happens to the plan.
  const pending = await prisma.platformPayment.findMany({
    where: { gymId, kind: "SUBSCRIPTION", status: "PENDING", ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  for (const p of pending) {
    // Mark it first: the provider's "expired" callback for it is then ignored instead of flagging the gym past due.
    await prisma.platformPayment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    if (p.externalInvoiceId) await expireInvoice(p.externalInvoiceId, p.provider);
  }
}

/**
 * Bank-transfer invoice: no provider involved. The billing page shows the platform's bank details and a
 * reference; the superadmin marks it paid once the money arrives. Reuses the gym's open one for the same plan.
 */
async function openManualInvoice(gym: BillableGym, plan: BillablePlan): Promise<{ paymentId: string; url: string; created: boolean }> {
  const url = `/${gym.slug}/billing`;
  const open = await prisma.platformPayment.findFirst({
    where: { gymId: gym.id, kind: "SUBSCRIPTION", status: "PENDING", provider: "manual" },
    orderBy: { createdAt: "desc" },
  });
  if (open && open.saasPlanId === plan.id) return { paymentId: open.id, url, created: false };

  await retirePendingPlatformInvoices(gym.id);
  const payment = await prisma.platformPayment.create({
    data: { gymId: gym.id, saasPlanId: plan.id, provider: "manual", amount: Number(plan.price), status: "PENDING" },
  });
  return { paymentId: payment.id, url, created: true };
}

/**
 * Returns a payable subscription invoice for `plan`, reusing the gym's open one if it's still live.
 * A gym only ever has one open invoice: creating a new one retires the others, so paying an old
 * renewal can't undo a plan change (or vice versa).
 */
export async function openPlatformInvoice(
  gym: BillableGym,
  plan: BillablePlan,
  purpose: "renewal" | "plan change",
): Promise<{ paymentId: string; url: string; created: boolean }> {
  if (manualPlatformBilling()) return openManualInvoice(gym, plan);
  if (!onlinePaymentsEnabled() && !isMockMode()) throw new PaymentsDisabledError();

  const open = await prisma.platformPayment.findFirst({
    where: { gymId: gym.id, status: "PENDING", externalInvoiceId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (open && open.saasPlanId === plan.id && open.invoiceUrl) {
    const state = await getInvoiceState(open.externalInvoiceId!, open.createdAt, open.provider);
    if (state === "PENDING") return { paymentId: open.id, url: open.invoiceUrl, created: false };
  }

  await retirePendingPlatformInvoices(gym.id);

  const payment = await prisma.platformPayment.create({
    data: { gymId: gym.id, saasPlanId: plan.id, provider: platformProviderName(), amount: Number(plan.price), status: "PENDING" },
  });
  try {
    const invoice = await createInvoice({
      externalId: payment.id,
      amount: Number(plan.price),
      description: `${plan.name}: ${gym.name} ${purpose === "renewal" ? "subscription renewal" : "plan change"}`,
      currency: plan.currency,
      successRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/${gym.slug}/billing`,
    });
    // In dev mock mode there's no provider page, so use our own test checkout on the billing page.
    const url = isMockMode() ? `/${gym.slug}/billing?mock-invoice=${payment.id}` : invoice.url;
    await prisma.platformPayment.update({ where: { id: payment.id }, data: { externalInvoiceId: invoice.id, invoiceUrl: url } });
    return { paymentId: payment.id, url, created: true };
  } catch (err) {
    // No invoice means nothing to pay; don't leave a dangling PENDING record behind.
    await prisma.platformPayment.delete({ where: { id: payment.id } }).catch(() => undefined);
    throw err;
  }
}
