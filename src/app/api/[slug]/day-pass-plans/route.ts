import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { createDayPassPlanSchema } from "@/lib/validation/tenant";

/** Owner creates a day-pass plan: a named one-visit ticket with a price. It never creates a member. */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
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
  if (session.role !== "OWNER") return NextResponse.json({ error: "Only the owner can manage day passes" }, { status: 403 });

  const parsed = createDayPassPlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the name and price." }, { status: 400 });

  const plan = await db.dayPassPlan.create({ data: { gymId: gym.id, ...parsed.data } });
  return NextResponse.json({ planId: plan.id }, { status: 201 });
}
