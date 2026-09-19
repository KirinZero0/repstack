import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { processPaymentEvent } from "@/lib/payments";
import { isMockMode } from "@/lib/xendit";

/** Dev-only stand-in for "owner paid the signup invoice". 404s unless XENDIT_MOCK=1 outside production. */
export async function POST(req: NextRequest) {
  if (!isMockMode()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const id = z.object({ signupId: z.string().uuid() }).safeParse(body);
  if (!id.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const matched = await processPaymentEvent({
    id: `mock_evt_${id.data.signupId}`,
    external_id: id.data.signupId,
    status: "PAID",
    paid_at: new Date().toISOString(),
  });
  return matched ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Signup not found" }, { status: 404 });
}
