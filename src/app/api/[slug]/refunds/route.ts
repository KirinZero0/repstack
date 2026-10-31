import { NextRequest, NextResponse } from "next/server";
import { tenantOrResponse } from "@/lib/routeAuth";
import { refundSchema } from "@/lib/validation/tenant";
import { refundInstant } from "@/lib/refunds";

/**
 * The owner records money the gym gave back (a no-show, a cancelled membership, a goodwill refund, anything).
 * It isn't tied to a payment: finance subtracts it on the day it went back. Owner only, like Finance itself.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await tenantOrResponse(params.slug, { ownerOnly: "Only the owner can record a refund" });
  if ("response" in auth) return auth.response;
  const { session, gym, db } = auth.ctx;

  const parsed = refundSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form" }, { status: 400 });
  const d = parsed.data;

  const refundedAt = refundInstant(d.date, gym.timezone);
  if (!refundedAt) return NextResponse.json({ error: "The refund date can't be in the future." }, { status: 400 });

  const refund = await db.refund.create({
    data: {
      gymId: gym.id,
      amount: d.amount,
      recipientName: d.recipientName,
      reason: d.reason,
      category: d.category,
      method: d.method,
      refundedAt,
      note: d.note || null,
      recordedById: session.staffUserId,
    },
  });
  return NextResponse.json({ ok: true, id: refund.id }, { status: 201 });
}
