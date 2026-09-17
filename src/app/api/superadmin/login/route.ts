import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";
import { superadminLoginSchema } from "@/lib/validation/superadmin";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = superadminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const superadmin = await prisma.superadmin.findUnique({ where: { email } });
  if (!superadmin) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, superadmin.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await setSessionCookie({ kind: "superadmin", superadminId: superadmin.id });

  return NextResponse.json({ ok: true });
}
