import { NextResponse } from "next/server";
import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkOutMember } from "@/lib/occupancy";

/** A member leaving taps "Check out" on their dashboard, so the gym's live count stays honest. */
export async function POST() {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    return NextResponse.json({ error: "Log in as a member to check out" }, { status: 401 });
  }

  const db = tenantDb(session.gymId);
  const gym = await db.gym.findUnique({ where: { id: session.gymId }, select: { settings: true } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  const checkedOutAt = new Date();
  const closed = await checkOutMember(db, session.gymId, session.memberId, gym.settings, checkedOutAt);
  if (closed === 0) return NextResponse.json({ error: "You're not checked in right now" }, { status: 409 });
  return NextResponse.json({ ok: true, checkedOutAt });
}
