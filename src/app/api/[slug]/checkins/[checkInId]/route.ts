import { NextRequest, NextResponse } from "next/server";
import { tenantOrResponse } from "@/lib/routeAuth";

/**
 * Owner or staff removes a check-in that was a mistake (wrong person scanned, tapped twice, a manual
 * check-in on the wrong member). It disappears from the day's list and the member's visit count, and
 * their daily check-in is free again.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; checkInId: string } }) {
  const auth = await tenantOrResponse(params.slug);
  if ("response" in auth) return auth.response;
  const { gym, db } = auth.ctx;

  // Tenant isolation: the check-in must belong to the session's gym.
  const checkIn = await db.checkIn.findUnique({ where: { id: params.checkInId } });
  if (!checkIn || checkIn.gymId !== gym.id) return NextResponse.json({ error: "Check-in not found" }, { status: 404 });

  await db.checkIn.delete({ where: { id: checkIn.id } });
  return NextResponse.json({ ok: true });
}
