import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: { gymId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId } });
  if (!gym) {
    return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  }

  await prisma.gym.update({
    where: { id: gym.id },
    data: { subscriptionStatus: "ACTIVE" },
  });

  await writeAuditLog({
    superadminId: session.superadminId,
    gymId: gym.id,
    action: "GYM_REACTIVATED",
    metadata: { previousStatus: gym.subscriptionStatus },
  });

  return NextResponse.json({ ok: true });
}
