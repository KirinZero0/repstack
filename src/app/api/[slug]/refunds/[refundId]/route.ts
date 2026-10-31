import { NextResponse } from "next/server";
import { tenantOrResponse } from "@/lib/routeAuth";

/**
 * The owner voids a refund recorded by mistake. It isn't deleted: it stays on record with who voided it and when,
 * finance stops subtracting it, and the exports list it as VOIDED. Like voiding a payment, it can't be undone.
 */
export async function POST(_req: Request, { params }: { params: { slug: string; refundId: string } }) {
  const auth = await tenantOrResponse(params.slug, { ownerOnly: "Only the owner can void a refund" });
  if ("response" in auth) return auth.response;
  const { session, gym, db } = auth.ctx;

  // Tenant isolation: the refund must belong to the session's gym.
  const refund = await db.refund.findUnique({ where: { id: params.refundId } });
  if (!refund || refund.gymId !== gym.id) return NextResponse.json({ error: "Refund not found" }, { status: 404 });

  // Compare-and-set, so two clicks can't both void it.
  const res = await db.refund.updateMany({
    where: { id: refund.id, gymId: gym.id, voidedAt: null },
    data: { voidedAt: new Date(), voidedById: session.staffUserId },
  });
  if (res.count !== 1) return NextResponse.json({ error: "This refund is already voided." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
