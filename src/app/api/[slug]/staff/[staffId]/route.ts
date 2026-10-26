import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { tenantOrResponse } from "@/lib/routeAuth";
import { prisma } from "@/lib/prisma";
import { staffActiveSchema } from "@/lib/validation/tenant";

/** Owner deactivates or reactivates a staff account. Deactivation takes effect on their next request. */
export async function PATCH(req: NextRequest, { params }: { params: { slug: string; staffId: string } }) {
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
    return NextResponse.json({ error: "Only the owner can change staff accounts" }, { status: 403 });
  }

  const parsed = staffActiveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Tenant isolation: the staff account must belong to the session's gym.
  const staff = await db.staffUser.findUnique({ where: { id: params.staffId } });
  if (!staff || staff.gymId !== gym.id) return NextResponse.json({ error: "Staff account not found" }, { status: 404 });
  if (staff.role === "OWNER") {
    return NextResponse.json({ error: "Owner accounts can't be deactivated." }, { status: 409 });
  }

  if (parsed.data.isActive && !staff.isActive) {
    const plan = await db.saasPlan.findUnique({ where: { id: gym.saasPlanId } });
    const activeStaff = await db.staffUser.count({ where: { gymId: gym.id, isActive: true } });
    if (plan && activeStaff >= plan.maxStaff) {
      return NextResponse.json({ error: `Your ${plan.name} plan allows ${plan.maxStaff} staff accounts, including you.` }, { status: 403 });
    }
  }

  await db.staffUser.update({ where: { id: staff.id }, data: { isActive: parsed.data.isActive } });
  return NextResponse.json({ ok: true });
}

/**
 * Owner deletes a staff account made by mistake (wrong email, no longer needed). It stops working at
 * once and the email is free again. Their name simply disappears from past records (who confirmed a
 * payment, who scanned a ticket); the records themselves stay. The owner account can't be deleted.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; staffId: string } }) {
  const auth = await tenantOrResponse(params.slug, { ownerOnly: "Only the owner can delete staff accounts" });
  if ("response" in auth) return auth.response;
  const { gym, db } = auth.ctx;

  // Tenant isolation: the staff account must belong to the session's gym.
  const staff = await db.staffUser.findUnique({ where: { id: params.staffId } });
  if (!staff || staff.gymId !== gym.id) return NextResponse.json({ error: "Staff account not found" }, { status: 404 });
  if (staff.role === "OWNER") return NextResponse.json({ error: "Owner accounts can't be deleted." }, { status: 409 });

  await prisma.$transaction([
    prisma.passwordReset.deleteMany({ where: { kind: "staff", subjectId: staff.id } }),
    prisma.staffUser.delete({ where: { id: staff.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
