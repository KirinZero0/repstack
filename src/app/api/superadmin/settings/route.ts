import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { platformSettingsSchema } from "@/lib/validation/superadmin";
import { writeAuditLog } from "@/lib/audit";
import { OVERRIDE_KEY, THEME_KEY } from "@/lib/theme";

export async function POST(req: NextRequest) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = platformSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { themeDefault, allowUserOverride } = parsed.data;

  await prisma.$transaction([
    prisma.appConfig.upsert({ where: { key: THEME_KEY }, create: { key: THEME_KEY, value: themeDefault }, update: { value: themeDefault } }),
    prisma.appConfig.upsert({ where: { key: OVERRIDE_KEY }, create: { key: OVERRIDE_KEY, value: allowUserOverride }, update: { value: allowUserOverride } }),
  ]);

  await writeAuditLog({
    superadminId: session.superadminId,
    action: "PLATFORM_SETTINGS_UPDATED",
    metadata: { themeDefault, allowUserOverride },
  });

  return NextResponse.json({ ok: true });
}
