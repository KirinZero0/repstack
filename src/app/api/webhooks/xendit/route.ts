import { NextRequest, NextResponse } from "next/server";
import { processPaymentEvent } from "@/lib/payments";
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

  const matched = await processPaymentEvent(event);
  if (!matched) return NextResponse.json({ error: "Unknown external_id" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
