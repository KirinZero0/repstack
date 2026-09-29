import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { createClassSessionSchema } from "@/lib/validation/tenant";
import { zonedTimeToUtc } from "@/lib/date";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Owner schedules a session of a class — or the same slot weekly for N weeks, which simply creates
 * N rows. There's no recurrence rule to keep in sync, so editing one occurrence never affects the rest.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string; classId: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can schedule classes" }, { status: 403 });
  }

  const parsed = createClassSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a valid date, time and number of weeks." }, { status: 400 });
  const d = parsed.data;

  // Tenant isolation: the class must belong to the session's gym.
  const cls = await db.gymClass.findUnique({ where: { id: params.classId } });
  if (!cls || cls.gymId !== gym.id) return NextResponse.json({ error: "Class not found" }, { status: 404 });

  const first = zonedTimeToUtc(d.startsAt, gym.timezone);
  if (Number.isNaN(first.getTime())) return NextResponse.json({ error: "Pick a valid date and time." }, { status: 400 });
  if (first.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: "The first session can't be in the past." }, { status: 400 });
  }

  const rows = Array.from({ length: d.repeatWeeks }, (_, i) => ({
    gymId: gym.id,
    classId: cls.id,
    startsAt: new Date(first.getTime() + i * WEEK_MS),
    capacity: d.capacity ?? null,
  }));
  await db.classSession.createMany({ data: rows });

  return NextResponse.json({ created: rows.length, firstStartsAt: first.toISOString() }, { status: 201 });
}
