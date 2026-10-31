import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({ isTest: z.boolean() });

/**
 * A superadmin marks a gym as a test gym, or back to a real one. A test gym is left out of platform revenue and
 * totals, is never billed or suspended by the subscription cron, and sends nothing automatically.
 */
export async function POST(req: NextRequest, { params }: { params: { gymId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId }, select: { id: true, isTest: true } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  await prisma.gym.update({ where: { id: gym.id }, data: { isTest: parsed.data.isTest } });
  await writeAuditLog({
    superadminId: session.superadminId,
    gymId: gym.id,
    action: "GYM_TEST_FLAG_CHANGED",
    metadata: { isTest: parsed.data.isTest, was: gym.isTest },
  });
  return NextResponse.json({ ok: true, isTest: parsed.data.isTest });
}
