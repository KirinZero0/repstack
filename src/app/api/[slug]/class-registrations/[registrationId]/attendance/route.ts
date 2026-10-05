import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { ATTENDANCE_OPENS_BEFORE_MS, classAttendanceSchema } from "@/lib/validation/tenant";

/**
 * Owner or staff marks a booked member as attended or a no-show, from the roster, once the
 * session is about to start. A cancelled booking has nothing to mark. Sending null clears it.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string; registrationId: string } }) {
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

  const parsed = classAttendanceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Tenant isolation: the registration must belong to the session's gym.
  const reg = await db.classRegistration.findUnique({ where: { id: params.registrationId }, include: { session: true } });
  if (!reg || reg.gymId !== gym.id) return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  if (reg.status === "CANCELLED") return NextResponse.json({ error: "This booking was cancelled." }, { status: 409 });
  if (reg.session.status === "CANCELLED") return NextResponse.json({ error: "This session was cancelled." }, { status: 409 });
  if (reg.session.startsAt.getTime() - Date.now() > ATTENDANCE_OPENS_BEFORE_MS) {
    return NextResponse.json({ error: "Attendance opens 30 minutes before the session starts." }, { status: 409 });
  }

  await db.classRegistration.update({
    where: { id: reg.id },
    data: { attendance: parsed.data.attendance, attendanceAt: parsed.data.attendance ? new Date() : null },
  });
  return NextResponse.json({ ok: true, attendance: parsed.data.attendance });
}
