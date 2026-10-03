import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { whatsappTestSchema } from "@/lib/validation/tenant";
import { decrypt } from "@/lib/crypto";
import { sendWithGateway, type GatewayProvider } from "@/lib/whatsapp";

/** Sends one message through the gym's own saved token, so the owner can tell it works before members rely on it. */
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

  const parsed = whatsappTestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const config = await db.whatsappSenderConfig.findUnique({ where: { gymId: gym.id } });
  if (!config) return NextResponse.json({ error: "Save your WhatsApp token first" }, { status: 409 });

  let apiKey: string;
  try {
    apiKey = decrypt(config.apiKeyEncrypted);
  } catch {
    return NextResponse.json({ error: "The saved token could not be read. Please enter it again." }, { status: 500 });
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
