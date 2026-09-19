import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { requireTenantSession, SessionError } from "@/lib/session";
import { gymThemeSchema } from "@/lib/validation/tenant";

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
    return NextResponse.json({ error: "Only the owner can change gym settings" }, { status: 403 });
  }

  const parsed = gymThemeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const current = (gym.settings ?? {}) as Record<string, unknown>;
  const rest = { ...current };
  delete rest.theme;
  const next = parsed.data.theme === "inherit" ? rest : { ...rest, theme: parsed.data.theme };

  await prisma.gym.update({ where: { id: gym.id }, data: { settings: next as Prisma.InputJsonValue } });
  return NextResponse.json({ ok: true });
}
