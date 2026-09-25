import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { whatsappConfigSchema } from "@/lib/validation/tenant";
import { encrypt } from "@/lib/crypto";

/** Owner saves the gym's own WhatsApp gateway. The API key is encrypted and never sent back. */
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
    return NextResponse.json({ error: "Only the owner can change WhatsApp settings" }, { status: 403 });
  }

  const parsed = whatsappConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the sender number and API key and try again." }, { status: 400 });
  }
  const d = parsed.data;

  const existing = await db.whatsappSenderConfig.findUnique({ where: { gymId: gym.id } });
  if (!existing && !d.apiKey) {
    return NextResponse.json({ error: "Enter the API key from your WhatsApp gateway." }, { status: 400 });
  }

  if (existing) {
    await db.whatsappSenderConfig.update({
      where: { gymId: gym.id },
      data: {
        gatewayProvider: d.provider,
        senderNumber: d.senderNumber,
        isActive: d.isActive,
        ...(d.apiKey ? { apiKeyEncrypted: encrypt(d.apiKey) } : {}),
      },
    });
  } else {
    await db.whatsappSenderConfig.create({
      data: {
        gymId: gym.id,
        gatewayProvider: d.provider,
        senderNumber: d.senderNumber,
        apiKeyEncrypted: encrypt(d.apiKey!),
        isActive: d.isActive,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
