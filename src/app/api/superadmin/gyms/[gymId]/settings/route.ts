import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { gymSettingsSchema } from "@/lib/validation/tenant";
import { gymSettingsUpdate } from "@/lib/gymSettings";

/**
 * A superadmin changes any gym's settings: everything the owner can, with the same validation. Each change is
 * written to the audit log with the keys it touched.
 */
export async function POST(req: NextRequest, { params }: { params: { gymId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = gymSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  await prisma.gym.update({ where: { id: gym.id }, data: gymSettingsUpdate(gym.settings, parsed.data) });
  await writeAuditLog({
    superadminId: session.superadminId,
    gymId: gym.id,
    action: "GYM_SETTINGS_CHANGED",
    // Which settings, not their values: bank details and the like stay out of the log.
    metadata: { keys: Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k]) => k) },
  });
  return NextResponse.json({ ok: true });
}
