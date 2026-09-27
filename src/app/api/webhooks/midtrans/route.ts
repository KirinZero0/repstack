import { NextRequest, NextResponse } from "next/server";
import { processPaymentEvent } from "@/lib/payments";
import {
  parseMidtransTime,
  recordIdFromOrderId,
  stateFromMidtrans,
  verifyMidtransSignature,
  type MidtransNotification,
} from "@/lib/midtrans";

/**
 * Midtrans payment notification. Set this URL under Settings > Configuration > Payment Notification URL
 * in the Midtrans dashboard. The signature is checked first; only settled and expired payments change
 * anything, every other status is acknowledged and ignored. Same idempotent handling as Xendit.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as MidtransNotification | null;
  if (!body || !verifyMidtransSignature(body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const state = stateFromMidtrans(body.transaction_status, body.fraud_status);
  if (state === "PENDING") return NextResponse.json({ ok: true, ignored: true });

  const paidAt = parseMidtransTime(body.settlement_time) ?? parseMidtransTime(body.transaction_time);
  const matched = await processPaymentEvent({
    id: body.transaction_id ?? body.order_id!,
    external_id: recordIdFromOrderId(body.order_id!),
    status: state,
    paid_at: paidAt?.toISOString(),
  });
  if (!matched) return NextResponse.json({ error: "Unknown order_id" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
