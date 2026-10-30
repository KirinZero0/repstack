import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { GYM_FEATURE_KEYS } from "@/config/features";
import { gymFeatures } from "@/lib/features";

const schema = z.object({ feature: z.enum(GYM_FEATURE_KEYS as [string, ...string[]]), enabled: z.boolean() });

/** A superadmin grants or takes away one optional feature for one gym. The gym's owner has no way to do this. */
export async function POST(req: NextRequest, { params }: { params: { gymId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown feature" }, { status: 400 });
  const { feature, enabled } = parsed.data;

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  const before = gymFeatures(gym.features)[feature as keyof ReturnType<typeof gymFeatures>];
  const stored = { ...((gym.features ?? {}) as Record<string, unknown>), [feature]: enabled };
  await prisma.gym.update({ where: { id: gym.id }, data: { features: stored as Prisma.InputJsonValue } });
  await writeAuditLog({
    superadminId: session.superadminId,
    gymId: gym.id,
    action: "GYM_FEATURE_CHANGED",
    metadata: { feature, enabled, was: before },
  });
  return NextResponse.json({ ok: true, features: gymFeatures(stored) });
}
