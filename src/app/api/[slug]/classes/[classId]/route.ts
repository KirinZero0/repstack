import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { updateClassSchema } from "@/lib/validation/tenant";

/** Owner edits or deactivates a class type. Price changes apply to new registrations only. */
export async function PATCH(req: NextRequest, { params }: { params: { slug: string; classId: string } }) {
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
    return NextResponse.json({ error: "Only the owner can manage classes" }, { status: 403 });
  }

  const parsed = updateClassSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the class details and try again." }, { status: 400 });
  const d = parsed.data;

  // Tenant isolation: the class must belong to the session's gym.
  const cls = await db.gymClass.findUnique({ where: { id: params.classId } });
  if (!cls || cls.gymId !== gym.id) return NextResponse.json({ error: "Class not found" }, { status: 404 });

  await db.gymClass.update({
    where: { id: cls.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...("description" in d ? { description: d.description ?? null } : {}),
      ...("instructor" in d ? { instructor: d.instructor ?? null } : {}),
      ...(d.price !== undefined ? { price: d.price } : {}),
      ...("capacity" in d ? { capacity: d.capacity ?? null } : {}),
      ...(d.durationMinutes !== undefined ? { durationMinutes: d.durationMinutes } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
