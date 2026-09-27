import crypto from "crypto";

/**
 * Midtrans (Snap). Set MIDTRANS_SERVER_KEY, and MIDTRANS_IS_PRODUCTION=1 only for live keys; anything
 * else talks to the sandbox. Money is IDR only. Midtrans never accepts the same order id twice, and a signup
 * can need a second invoice after the first expires, so the order id is our record id plus "~" and a random
 * suffix. A notification maps back to the record by cutting at the "~".
 */

const isProduction = () => process.env.MIDTRANS_IS_PRODUCTION === "1";
const snapBase = () => (isProduction() ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com");
const apiBase = () => (isProduction() ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com");

function serverKey(): string {
  const key = process.env.MIDTRANS_SERVER_KEY;
  if (!key) throw new Error("MIDTRANS_SERVER_KEY env var not set");
  return key;
}

const authHeader = () => `Basic ${Buffer.from(`${serverKey()}:`).toString("base64")}`;

export interface MidtransInvoiceParams {
  externalId: string;
  amount: number;
  description: string;
  payerEmail?: string;
  currency?: string;
  successRedirectUrl?: string;
}

/** Midtrans wants whole rupiah, an item list that adds up to the total, and item names of at most 50 characters. */
export function buildSnapRequest(p: MidtransInvoiceParams, orderId: string) {
  const amount = Math.round(p.amount);
  return {
    transaction_details: { order_id: orderId, gross_amount: amount },
    item_details: [{ id: "repstack", price: amount, quantity: 1, name: p.description.slice(0, 50) }],
    ...(p.payerEmail ? { customer_details: { email: p.payerEmail } } : {}),
    ...(p.successRedirectUrl ? { callbacks: { finish: p.successRedirectUrl } } : {}),
    expiry: { unit: "hours", duration: 24 },
  };
}

export async function createMidtransTransaction(p: MidtransInvoiceParams): Promise<{ id: string; url: string }> {
  if ((p.currency ?? "IDR") !== "IDR") throw new Error("Midtrans only supports IDR");
  const orderId = `${p.externalId}~${crypto.randomBytes(3).toString("hex")}`;
  const res = await fetch(`${snapBase()}/snap/v1/transactions`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(buildSnapRequest(p, orderId)),
  });
  if (!res.ok) throw new Error(`Midtrans transaction creation failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { token?: string; redirect_url?: string };
  if (!body.redirect_url) throw new Error("Midtrans did not return a payment page");
  // The order id is what Midtrans knows the payment by, so it doubles as the invoice id we store.
  return { id: orderId, url: body.redirect_url };
}

export type MidtransState = "PENDING" | "PAID" | "EXPIRED";

/** Maps a Midtrans transaction_status (from the status API or a notification) to what we act on. */
export function stateFromMidtrans(transactionStatus: string | undefined, fraudStatus?: string): MidtransState {
  switch (transactionStatus) {
    case "settlement":
      return "PAID";
    case "capture":
      // A card payment held for fraud review isn't money yet.
      return !fraudStatus || fraudStatus === "accept" ? "PAID" : "PENDING";
    case "expire":
    case "cancel":
      return "EXPIRED";
    default:
      // pending, authorize, deny and failure all leave the customer able to try again until it expires.
      return "PENDING";
  }
}

/** Snap payment pages stop working after the expiry we asked for, whether or not anyone tried to pay. */
const UNUSED_PAGE_LIFETIME_MS = 23 * 60 * 60 * 1000;

export async function getMidtransState(orderId: string, createdAt: Date): Promise<MidtransState | null> {
  const res = await fetch(`${apiBase()}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  const body = (await res.json().catch(() => null)) as { status_code?: string; transaction_status?: string; fraud_status?: string } | null;
  if (!body) return null;
  // Midtrans answers "404" (in the body, sometimes with HTTP 200) when nobody has started paying yet.
  if (res.status === 404 || body.status_code === "404") {
    return Date.now() - createdAt.getTime() > UNUSED_PAGE_LIFETIME_MS ? "EXPIRED" : "PENDING";
  }
  if (!res.ok) return null;
  return stateFromMidtrans(body.transaction_status, body.fraud_status);
}

/** Best effort: only works once a payment attempt exists; an untouched page simply times out. */
export async function expireMidtransTransaction(orderId: string): Promise<void> {
  try {
    const res = await fetch(`${apiBase()}/v2/${encodeURIComponent(orderId)}/expire`, {
      method: "POST",
      headers: { Authorization: authHeader(), Accept: "application/json" },
    });
    if (!res.ok && res.status !== 404) console.error(`Could not expire Midtrans order ${orderId} (${res.status})`);
  } catch (err) {
    console.error(`Could not expire Midtrans order ${orderId}`, err);
  }
}

export interface MidtransNotification {
  order_id?: string;
  status_code?: string;
  gross_amount?: string;
  signature_key?: string;
  transaction_status?: string;
  fraud_status?: string;
  transaction_id?: string;
  settlement_time?: string;
  transaction_time?: string;
}

/** Midtrans signs a notification as SHA-512 of order_id + status_code + gross_amount + server key. */
export function verifyMidtransSignature(n: MidtransNotification): boolean {
  const key = process.env.MIDTRANS_SERVER_KEY;
  if (!key || !n.order_id || !n.status_code || !n.gross_amount || !n.signature_key) return false;
  const expected = crypto.createHash("sha512").update(`${n.order_id}${n.status_code}${n.gross_amount}${key}`).digest("hex");
  const actual = Buffer.from(n.signature_key, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

/** Midtrans timestamps look like "2026-09-27 10:00:00" and are in Western Indonesia time (UTC+7). */
export function parseMidtransTime(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value.replace(" ", "T")}+07:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** The record id inside a Midtrans order id (everything before the "~" suffix). */
export function recordIdFromOrderId(orderId: string): string {
  return orderId.split("~")[0];
}
