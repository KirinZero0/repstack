import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { processPaymentEvent } from "@/lib/payments";
import { isMockMode } from "@/lib/xendit";

/** Dev-only stand-in for "customer paid on Xendit". 404s unless XENDIT_MOCK=1 outside production. */
export async function POST(req: NextRequest) {
  if (!isMockMode()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await getSession();
  if (!session || session.kind !== "member") {
    return NextResponse.json({ error: "Log in as a member" }, { status: 401 });
  }

  const { paymentId } = (await req.json().catch(() => ({}))) as { paymentId?: string };
  const payment = paymentId ? await prisma.payment.findUnique({ where: { id: paymentId } }) : null;
  if (!payment || payment.memberId !== session.memberId) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  await processPaymentEvent({ id: `mock_evt_${payment.id}`, external_id: payment.id, status: "PAID", paid_at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
