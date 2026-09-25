import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { staffActiveSchema } from "@/lib/validation/tenant";

/** Owner deactivates or reactivates a staff account. Deactivation takes effect on their next request. */
export async function PATCH(req: NextRequest, { params }: { params: { slug: string; staffId: string } }) {
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
    return NextResponse.json({ error: "Only the owner can change staff accounts" }, { status: 403 });
  }

  const parsed = staffActiveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Tenant isolation: the staff account must belong to the session's gym.
  const staff = await prisma.staffUser.findUnique({ where: { id: params.staffId } });
  if (!staff || staff.gymId !== gym.id) return NextResponse.json({ error: "Staff account not found" }, { status: 404 });
  if (staff.role === "OWNER") {
    return NextResponse.json({ error: "Owner accounts can't be deactivated." }, { status: 409 });
  }

  if (parsed.data.isActive && !staff.isActive) {
    const plan = await prisma.saasPlan.findUnique({ where: { id: gym.saasPlanId } });
    const activeStaff = await prisma.staffUser.count({ where: { gymId: gym.id, isActive: true } });
    if (plan && activeStaff >= plan.maxStaff) {
      return NextResponse.json({ error: `Your ${plan.name} plan allows ${plan.maxStaff} staff accounts, including you.` }, { status: 403 });
    }
  }

  await prisma.staffUser.update({ where: { id: staff.id }, data: { isActive: parsed.data.isActive } });
  return NextResponse.json({ ok: true });
}
