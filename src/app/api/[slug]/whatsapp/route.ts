import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { whatsappConfigSchema } from "@/lib/validation/tenant";
import { encrypt, normalizePhone } from "@/lib/crypto";

async function ownerSession(slug: string) {
  try {
    const { session, gym, db } = await requireTenantSession(slug);
    if (session.role !== "OWNER") {
      return { error: NextResponse.json({ error: "Only the owner can change WhatsApp settings" }, { status: 403 }) };
    }
    return { gym, db };
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return { error: NextResponse.json({ error: err.message }, { status }) };
    }
    throw err;
  }
}

/** Connects (or replaces) the gym's own Fonnte device token. Stored encrypted; never returned. */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await ownerSession(params.slug);
  if ("error" in auth) return auth.error;
  const { gym, db } = auth;

  const parsed = whatsappConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const senderNumber = normalizePhone(parsed.data.senderNumber);
  const apiKeyEncrypted = encrypt(parsed.data.token);
  await db.whatsappSenderConfig.upsert({
    where: { gymId: gym.id },
    create: { gymId: gym.id, gatewayProvider: "fonnte", senderNumber, apiKeyEncrypted, isActive: true },
    update: { gatewayProvider: "fonnte", senderNumber, apiKeyEncrypted, isActive: true },
  });

  return NextResponse.json({ ok: true });
}

/** Disconnects the gym's own number; its messages go back to the platform's shared number. */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await ownerSession(params.slug);
  if ("error" in auth) return auth.error;
  const { gym, db } = auth;

  await db.whatsappSenderConfig.deleteMany({ where: { gymId: gym.id } });
  return NextResponse.json({ ok: true });
}
