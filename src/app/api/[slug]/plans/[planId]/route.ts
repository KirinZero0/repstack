import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { updatePlanSchema } from "@/lib/validation/tenant";

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
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can manage plans" }, { status: 403 });
  }

  const parsed = updatePlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Tenant isolation: the plan must belong to the session's gym.
  const plan = await db.membershipPlan.findUnique({ where: { id: params.planId } });
  if (!plan || plan.gymId !== gym.id) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  await db.membershipPlan.update({ where: { id: plan.id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}

/**
 * Owner deletes a plan nobody ever used. Once a member, payment or join request points at it the
 * plan is part of the gym's history and can only be hidden, so those get a 409 that says so.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; planId: string } }) {
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
    return NextResponse.json({ error: "Only the owner can manage plans" }, { status: 403 });
  }

  const plan = await db.membershipPlan.findUnique({
    where: { id: params.planId },
    include: { _count: { select: { members: true, payments: true, signups: true } } },
  });
  if (!plan || plan.gymId !== gym.id) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  const used = plan._count.members + plan._count.payments + plan._count.signups;
  if (used > 0) {
    return NextResponse.json(
      { error: `"${plan.name}" has ${plan._count.members} member${plan._count.members === 1 ? "" : "s"} and ${plan._count.payments} payment${plan._count.payments === 1 ? "" : "s"} on record, so it can't be deleted. Hide it instead.` },
      { status: 409 },
    );
  }

  await db.membershipPlan.delete({ where: { id: plan.id } });
  return NextResponse.json({ ok: true });
}
