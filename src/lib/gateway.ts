import { createXenditInvoice, expireXenditInvoice, getXenditInvoice, isMockMode } from "./xendit";
import { createMidtransTransaction, expireMidtransTransaction, getMidtransState } from "./midtrans";

export { isMockMode };

/**
 * The payment provider behind every invoice (member memberships, gym signups, subscriptions).
 * Chosen with PAYMENT_PROVIDER=xendit|midtrans (default xendit). Both feed the same payment
 * handling: their webhooks turn into one PAID/EXPIRED event for `processPaymentEvent`.
 */
export type ProviderName = "xendit" | "midtrans";

export function activeProvider(): ProviderName {
  return process.env.PAYMENT_PROVIDER === "midtrans" ? "midtrans" : "xendit";
}

/** The value for `Payment.provider` (an enum). */
export function paymentProviderEnum(): "XENDIT" | "MIDTRANS" {
  return activeProvider() === "midtrans" ? "MIDTRANS" : "XENDIT";
}

/** The value for `PlatformPayment.provider` (a string). */
export function platformProviderName(): ProviderName {
  return activeProvider();
}

/** Which provider an existing record was created with, so a later switch doesn't send it to the wrong one. */
function providerOf(recorded?: string | null): ProviderName {
  if (!recorded) return activeProvider();
  return recorded.toLowerCase() === "midtrans" ? "midtrans" : "xendit";
}

export interface InvoiceParams {
  externalId: string;
  amount: number;
  description: string;
  payerEmail?: string;
  currency?: string;
  successRedirectUrl?: string;
}

/** `id` is what to store in externalInvoiceId; `url` is the hosted page the payer opens. */
export async function createInvoice(params: InvoiceParams): Promise<{ id: string; url: string }> {
  if (isMockMode()) {
    return { id: `mock_${params.externalId}`, url: `/my?mock-invoice=${params.externalId}` };
  }
  if (activeProvider() === "midtrans") return createMidtransTransaction(params);
  const invoice = await createXenditInvoice(params);
  return { id: invoice.id, url: invoice.invoice_url };
}

export type InvoiceState = "PENDING" | "PAID" | "EXPIRED";

/** Whether an earlier invoice can still be paid. Null means we couldn't tell, so treat it as not reusable. */
export async function getInvoiceState(
  invoiceId: string,
  createdAt: Date,
  recordedProvider?: string | null,
): Promise<InvoiceState | null> {
  if (isMockMode()) return "PENDING";
  if (providerOf(recordedProvider) === "midtrans") return getMidtransState(invoiceId.replace(/^mock_/, ""), createdAt);
  const invoice = await getXenditInvoice(invoiceId);
  if (!invoice) return null;
  if (invoice.status === "PAID" || invoice.status === "SETTLED") return "PAID";
  return invoice.status === "EXPIRED" ? "EXPIRED" : "PENDING";
}

/** Best effort: stop an unpaid invoice from being paid later. */
export async function expireInvoice(invoiceId: string, recordedProvider?: string | null): Promise<void> {
  if (isMockMode()) return;
  if (providerOf(recordedProvider) === "midtrans") return expireMidtransTransaction(invoiceId);
  return expireXenditInvoice(invoiceId);
}
