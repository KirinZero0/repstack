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

/** Local/dev only: fake invoices so the payment flow can be exercised without Xendit credentials. */
export function isMockMode(): boolean {
  return process.env.XENDIT_MOCK === "1" && process.env.NODE_ENV !== "production";
}

export async function getXenditInvoice(invoiceId: string): Promise<XenditInvoiceResponse | null> {
  if (isMockMode()) {
    return {
      id: invoiceId,
      external_id: invoiceId.replace(/^mock_/, ""),
      invoice_url: `/my?mock-invoice=${invoiceId.replace(/^mock_/, "")}`,
      status: "PENDING",
    };
  }
  const auth = Buffer.from(`${getSecretKey()}:`).toString("base64");
  const res = await fetch(`${XENDIT_API_BASE}/v2/invoices/${invoiceId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as XenditInvoiceResponse;
}

/** Best effort: stops an unpaid invoice from being paid later. Failures are logged, never thrown. */
export async function expireXenditInvoice(invoiceId: string): Promise<void> {
  if (isMockMode()) return;
  try {
    const auth = Buffer.from(`${getSecretKey()}:`).toString("base64");
    const res = await fetch(`${XENDIT_API_BASE}/invoices/${invoiceId}/expire!`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) console.error(`Could not expire Xendit invoice ${invoiceId} (${res.status})`);
  } catch (err) {
    console.error(`Could not expire Xendit invoice ${invoiceId}`, err);
  }
}

function getSecretKey(): string {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) throw new Error("XENDIT_SECRET_KEY env var not set");
  return key;
}

export async function createXenditInvoice(
  params: CreateInvoiceParams,
): Promise<XenditInvoiceResponse> {
  if (isMockMode()) {
    return {
      id: `mock_${params.externalId}`,
      external_id: params.externalId,
      invoice_url: `/my?mock-invoice=${params.externalId}`,
      status: "PENDING",
    };
  }
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
