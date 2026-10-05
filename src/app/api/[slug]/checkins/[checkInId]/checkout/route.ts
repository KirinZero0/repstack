import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { checkOutMember } from "@/lib/occupancy";

/** Staff marks someone as having left, from the "in the gym now" list on the dashboard. */
export async function POST(_req: NextRequest, { params }: { params: { slug: string; checkInId: string } }) {
  let gym, db;
  try {
    ({ gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }

  // Tenant isolation: the check-in must belong to the session's gym.
  const checkIn = await db.checkIn.findUnique({ where: { id: params.checkInId } });
  if (!checkIn || checkIn.gymId !== gym.id || checkIn.result !== "SUCCESS") {
    return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
  }
  if (checkIn.checkedOutAt) {
    return NextResponse.json({ error: "Already checked out" }, { status: 409 });
  }

  // The row is how staff pointed at the person; the person is who leaves.
  const checkedOutAt = new Date();
  const closed = await checkOutMember(db, gym.id, checkIn.memberId, gym.settings, checkedOutAt);
  if (closed === 0) {
    // Older than the window: it no longer counts as "in", but close it anyway so the record is tidy.
    await db.checkIn.update({ where: { id: checkIn.id }, data: { checkedOutAt } });
  }
  return NextResponse.json({ ok: true, checkedOutAt });
}
