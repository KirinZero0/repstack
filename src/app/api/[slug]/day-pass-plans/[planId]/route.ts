import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { tenantOrResponse } from "@/lib/routeAuth";
import { updateDayPassPlanSchema } from "@/lib/validation/tenant";

/** Owner renames, reprices, or hides/shows a day-pass plan. Passes already issued keep working. */
export async function PATCH(req: NextRequest, { params }: { params: { slug: string; planId: string } }) {
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

  const parsed = updateDayPassPlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the name and price." }, { status: 400 });

  // Tenant isolation: the plan must belong to the session's gym.
  const plan = await db.dayPassPlan.findUnique({ where: { id: params.planId } });
  if (!plan || plan.gymId !== gym.id) return NextResponse.json({ error: "Day pass not found" }, { status: 404 });

  await db.dayPassPlan.update({ where: { id: plan.id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}

/**
 * Owner deletes a day-pass plan made by mistake. A plan anyone has already requested or bought is
 * part of the books, so it can only be hidden (PATCH isActive:false).
 */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; planId: string } }) {
  const auth = await tenantOrResponse(params.slug, { ownerOnly: "Only the owner can manage day passes" });
  if ("response" in auth) return auth.response;
  const { gym, db } = auth.ctx;

  // Tenant isolation: the plan must belong to the session's gym.
  const plan = await db.dayPassPlan.findUnique({ where: { id: params.planId } });
  if (!plan || plan.gymId !== gym.id) return NextResponse.json({ error: "Day pass not found" }, { status: 404 });

  if ((await db.guestPass.count({ where: { gymId: gym.id, dayPassPlanId: plan.id } })) > 0) {
    return NextResponse.json({ error: "People have already asked for or used this day pass, so it can't be deleted. Hide it instead." }, { status: 409 });
  }
  await db.dayPassPlan.delete({ where: { id: plan.id } });
  return NextResponse.json({ ok: true });
}
