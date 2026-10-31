import { NextResponse } from "next/server";
import { tenantOrResponse } from "@/lib/routeAuth";

/** The owner removes a refund recorded by mistake; finance stops subtracting it. */
export async function DELETE(_req: Request, { params }: { params: { slug: string; refundId: string } }) {
  const auth = await tenantOrResponse(params.slug, { ownerOnly: "Only the owner can remove a refund" });
  if ("response" in auth) return auth.response;
  const { gym, db } = auth.ctx;

  // Tenant isolation: the refund must belong to the session's gym.
  const res = await db.refund.deleteMany({ where: { id: params.refundId, gymId: gym.id } });
  if (res.count !== 1) return NextResponse.json({ error: "Refund not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
