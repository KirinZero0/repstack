import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { whatsappConfigSchema } from "@/lib/validation/tenant";
import { encrypt, normalizePhone } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/audit";

async function superadmin() {
  try {
    const { session } = await requireSuperadminSession();
    return { session };
  } catch (err) {
    if (err instanceof SessionError) return { error: NextResponse.json({ error: err.message }, { status: 401 }) };
    throw err;
  }
}

/** Connects (or replaces) a gym's own Fonnte device token. Stored encrypted; never returned. */
export async function POST(req: NextRequest, { params }: { params: { gymId: string } }) {
  const auth = await superadmin();
  if ("error" in auth) return auth.error;

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId }, select: { id: true } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  const parsed = whatsappConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const senderNumber = normalizePhone(parsed.data.senderNumber);
  const apiKeyEncrypted = encrypt(parsed.data.token);
  await prisma.whatsappSenderConfig.upsert({
    where: { gymId: gym.id },
    create: { gymId: gym.id, gatewayProvider: "fonnte", senderNumber, apiKeyEncrypted, isActive: true },
    update: { gatewayProvider: "fonnte", senderNumber, apiKeyEncrypted, isActive: true },
  });
  await writeAuditLog({ superadminId: auth.session.superadminId, gymId: gym.id, action: "WHATSAPP_CONNECTED", metadata: { senderNumber } });

  return NextResponse.json({ ok: true });
}

/** Disconnects the gym's own number; its messages go back to the platform's shared number. */
export async function DELETE(_req: NextRequest, { params }: { params: { gymId: string } }) {
  const auth = await superadmin();
  if ("error" in auth) return auth.error;

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId }, select: { id: true } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  await prisma.whatsappSenderConfig.deleteMany({ where: { gymId: gym.id } });
  await writeAuditLog({ superadminId: auth.session.superadminId, gymId: gym.id, action: "WHATSAPP_DISCONNECTED" });
  return NextResponse.json({ ok: true });
}
