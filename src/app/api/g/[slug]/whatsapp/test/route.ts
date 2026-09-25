import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { whatsappTestSchema } from "@/lib/validation/tenant";
import { decrypt } from "@/lib/crypto";
import { sendWithGateway, type GatewayProvider } from "@/lib/whatsapp";

const COOLDOWN_MS = 60_000;

/**
 * Sends one test message to the owner's own phone, using the gym's saved gateway, so they can
 * confirm the setup works. Only ever goes to the owner's number, and is rate limited, so it
 * can't be used to message arbitrary people.
 */
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
    return NextResponse.json({ error: "Only the owner can send a test message" }, { status: 403 });
  }

  const parsed = whatsappTestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "That phone number doesn't look right." }, { status: 400 });

  const config = await prisma.whatsappSenderConfig.findUnique({ where: { gymId: gym.id } });
  if (!config) return NextResponse.json({ error: "Save your WhatsApp settings first." }, { status: 400 });

  const settings = (gym.settings ?? {}) as Record<string, unknown>;
  const last = typeof settings.whatsappTestAt === "number" ? settings.whatsappTestAt : 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a minute before sending another test." }, { status: 429 });
  }

  const owner = await prisma.staffUser.findUnique({ where: { id: session.staffUserId } });
  let to = owner?.phone ?? null;
  if (parsed.data.phone && parsed.data.phone !== to) {
    await prisma.staffUser.update({ where: { id: session.staffUserId }, data: { phone: parsed.data.phone } });
    to = parsed.data.phone;
  }
  if (!to) return NextResponse.json({ error: "Enter your own WhatsApp number to receive the test." }, { status: 400 });

  await prisma.gym.update({
    where: { id: gym.id },
    data: { settings: { ...settings, whatsappTestAt: Date.now() } as Prisma.InputJsonValue },
  });

  const result = await sendWithGateway(
    config.gatewayProvider as GatewayProvider,
    decrypt(config.apiKeyEncrypted),
    to,
    `Test message from Iron Ledger for ${gym.name}. If you can read this, your WhatsApp setup works.`,
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: `The gateway rejected the message: ${result.error ?? "unknown error"}` },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true });
}
