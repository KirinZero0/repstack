import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireTenantSession, SessionError } from "@/lib/session";
import { gymSettingsSchema } from "@/lib/validation/tenant";

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
    return NextResponse.json({ error: "Only the owner can change gym settings" }, { status: 403 });
  }

  const parsed = gymSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const next = { ...((gym.settings ?? {}) as Record<string, unknown>) };
  if (parsed.data.theme !== undefined) {
    if (parsed.data.theme === "inherit") delete next.theme;
    else next.theme = parsed.data.theme;
  }
  if (parsed.data.acceptSignups !== undefined) next.acceptSignups = parsed.data.acceptSignups;
  if (parsed.data.paymentsEnabled !== undefined) next.paymentsEnabled = parsed.data.paymentsEnabled;
  if (parsed.data.notifyWhatsapp !== undefined) next.notifyWhatsapp = parsed.data.notifyWhatsapp;
  if (parsed.data.notifyEmail !== undefined) next.notifyEmail = parsed.data.notifyEmail;
  if (parsed.data.occupancyWindowHours !== undefined) next.occupancyWindowHours = parsed.data.occupancyWindowHours;
  if (parsed.data.checkinsPerDay !== undefined) next.checkinsPerDay = parsed.data.checkinsPerDay;
  if (parsed.data.checkinGapMinutes !== undefined) next.checkinGapMinutes = parsed.data.checkinGapMinutes;
  if (parsed.data.whoIsInEnabled !== undefined) next.whoIsInEnabled = parsed.data.whoIsInEnabled;

  await db.gym.update({
    where: { id: gym.id },
    data: {
      settings: next as Prisma.InputJsonValue,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone } : {}),
      ...(parsed.data.bankName !== undefined ? { bankName: parsed.data.bankName || null } : {}),
      ...(parsed.data.bankAccountNumber !== undefined ? { bankAccountNumber: parsed.data.bankAccountNumber || null } : {}),
      ...(parsed.data.bankAccountHolder !== undefined ? { bankAccountHolder: parsed.data.bankAccountHolder || null } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
      ...(parsed.data.address !== undefined ? { address: parsed.data.address || null } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
