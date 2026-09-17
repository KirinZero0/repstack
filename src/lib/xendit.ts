import crypto from "crypto";

const XENDIT_API_BASE = "https://api.xendit.co";

interface CreateInvoiceParams {
  externalId: string;
  amount: number;
  payerEmail?: string;
  description: string;
  currency?: string;
  successRedirectUrl?: string;
}

interface XenditInvoiceResponse {
  id: string;
  external_id: string;
  invoice_url: string;
  status: string;
}

function getSecretKey(): string {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) throw new Error("XENDIT_SECRET_KEY env var not set");
  return key;
}

export async function createXenditInvoice(
  params: CreateInvoiceParams,
): Promise<XenditInvoiceResponse> {
  if (!process.env.XENDIT_SECRET_KEY) {
    throw new Error("XENDIT_SECRET_KEY not configured — skipping real invoice creation");
  }
  const auth = Buffer.from(`${getSecretKey()}:`).toString("base64");
  const res = await fetch(`${XENDIT_API_BASE}/v2/invoices`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      external_id: params.externalId,
      amount: params.amount,
      payer_email: params.payerEmail,
      description: params.description,
      currency: params.currency ?? "IDR",
      success_redirect_url: params.successRedirectUrl,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Xendit invoice creation failed (${res.status}): ${body}`);
  }

  return (await res.json()) as XenditInvoiceResponse;
}

/**
 * Verifies the `x-callback-token` header on incoming Xendit webhook requests
 * against XENDIT_CALLBACK_TOKEN. Constant-time compare.
 */
export function verifyXenditCallback(headerToken: string | null): boolean {
  const expected = process.env.XENDIT_CALLBACK_TOKEN;
  if (!expected || !headerToken) return false;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(headerToken);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export interface XenditWebhookEvent {
  id: string;
  external_id: string;
  status: "PAID" | "EXPIRED" | "PENDING" | string;
  paid_at?: string;
}
