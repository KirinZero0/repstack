import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { updatePlanSchema } from "@/lib/validation/tenant";

export async function PATCH(req: NextRequest, { params }: { params: { slug: string; planId: string } }) {
  let session, gym;
  try {
    ({ session, gym } = await requireTenantSession(params.slug));
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
  const plan = await prisma.membershipPlan.findUnique({ where: { id: params.planId } });
  if (!plan || plan.gymId !== gym.id) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  await prisma.membershipPlan.update({ where: { id: plan.id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}
