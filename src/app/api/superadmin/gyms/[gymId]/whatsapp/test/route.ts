import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { whatsappTestSchema } from "@/lib/validation/tenant";
import { decrypt } from "@/lib/crypto";
import { sendWithGateway, type GatewayProvider } from "@/lib/whatsapp";

/** Sends one message through the gym's saved token, so the superadmin can tell it works before members rely on it. */
export async function POST(req: NextRequest, { params }: { params: { gymId: string } }) {
  try {
    await requireSuperadminSession();
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = whatsappTestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId }, select: { id: true, name: true } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  const config = await prisma.whatsappSenderConfig.findUnique({ where: { gymId: gym.id } });
  if (!config) return NextResponse.json({ error: "Save the WhatsApp token first" }, { status: 409 });

  let apiKey: string;
  try {
    apiKey = decrypt(config.apiKeyEncrypted);
  } catch {
    return NextResponse.json({ error: "The saved token could not be read. Enter it again." }, { status: 500 });
  }

  const result = await sendWithGateway(
    config.gatewayProvider as GatewayProvider,
    apiKey,
    parsed.data.phone,
    `Test message from ${gym.name}. If you can read this, WhatsApp is connected.`,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "The message could not be sent" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
