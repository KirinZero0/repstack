import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { createPlanSchema } from "@/lib/validation/tenant";

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
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

  const parsed = createPlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const plan = await prisma.membershipPlan.create({
    data: { gymId: gym.id, ...parsed.data },
  });
  return NextResponse.json({ planId: plan.id }, { status: 201 });
}
