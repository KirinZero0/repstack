import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";
import { memberLoginSchema } from "@/lib/validation/tenant";
import { compareOrDummy } from "@/lib/passwordTiming";

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = memberLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) {
    return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  }

  const { email, password } = parsed.data;
  const member = await prisma.member.findUnique({ where: { email } });
  const belongsToGym = Boolean(member && member.gymId === gym.id);

  // Always run bcrypt.compare (against a dummy hash if no match) so a nonexistent email,
  // an email from another gym, and a wrong password all take the same time to reject.
  const valid = await compareOrDummy(password, belongsToGym ? member!.passwordHash : null);

  if (!belongsToGym || !valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json(
      { error: "This gym's account is suspended. Contact your platform admin." },
      { status: 403 },
    );
  }

  await setSessionCookie({ kind: "member", memberId: member!.id, gymId: gym.id });

  return NextResponse.json({ ok: true });
}
