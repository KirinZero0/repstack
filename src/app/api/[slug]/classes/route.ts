import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { createClassSchema } from "@/lib/validation/tenant";

/** Owner creates a class type (e.g. "Yoga", 60 min, Rp 75,000). Sessions are scheduled separately. */
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
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can manage classes" }, { status: 403 });
  }

  const parsed = createClassSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the class details and try again." }, { status: 400 });
  const d = parsed.data;

  const cls = await db.gymClass.create({
    data: {
      gymId: gym.id,
      name: d.name,
      description: d.description ?? null,
      instructor: d.instructor ?? null,
      price: d.price,
      capacity: d.capacity ?? null,
      durationMinutes: d.durationMinutes,
      isActive: d.isActive,
    },
  });
  return NextResponse.json({ classId: cls.id }, { status: 201 });
}
