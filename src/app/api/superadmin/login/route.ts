import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";
import { superadminLoginSchema } from "@/lib/validation/superadmin";
import { compareOrDummy } from "@/lib/passwordTiming";
import { checkLoginThrottle } from "@/lib/loginThrottle";

export async function POST(req: NextRequest) {
  if (!(await checkLoginThrottle(req))) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = superadminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const superadmin = await prisma.superadmin.findUnique({ where: { email } });

  const valid = await compareOrDummy(password, superadmin?.passwordHash ?? null);

  if (!superadmin || !valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await setSessionCookie({ kind: "superadmin", superadminId: superadmin.id });

  return NextResponse.json({ ok: true });
}
