import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { remindClassSessionSchema } from "@/lib/validation/tenant";
import { sendClassReminder } from "@/lib/classes";

/**
 * Owner or staff nudges the members booked on a session, on demand: one member (registrationId) or
 * everyone still holding a seat. Confirmed members get a "see you there" reminder; unpaid ones are
 * told their seat is waiting for payment. Doesn't touch the cron's once-only reminder stamp.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string; sessionId: string } }) {
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

  const parsed = remindClassSessionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Tenant isolation: the session must belong to the session's gym.
  const cs = await db.classSession.findUnique({
    where: { id: params.sessionId },
    include: { registrations: { where: { status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } }, select: { id: true } } },
  });
  if (!cs || cs.gymId !== gym.id) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (cs.status !== "SCHEDULED" || cs.startsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "This session is cancelled or has already started." }, { status: 409 });
  }

  const ids = cs.registrations.map((r) => r.id);
  const targets = parsed.data.registrationId ? ids.filter((id) => id === parsed.data.registrationId) : ids;
  if (targets.length === 0) {
    return NextResponse.json({ error: parsed.data.registrationId ? "That booking isn't active." : "Nobody is booked on this session." }, { status: 409 });
  }

  for (const id of targets) await sendClassReminder(id);
  return NextResponse.json({ ok: true, reminded: targets.length });
}
