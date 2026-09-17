import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";
import { staffLoginSchema } from "@/lib/validation/tenant";
import { compareOrDummy } from "@/lib/passwordTiming";

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = staffLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) {
    return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  }

  const { email, password } = parsed.data;
  const staff = await prisma.staffUser.findUnique({ where: { email } });
  const belongsToGym = Boolean(staff && staff.gymId === gym.id);

  const valid = await compareOrDummy(password, belongsToGym ? staff!.passwordHash : null);

  if (!belongsToGym || !valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json(
      { error: "This gym's account is suspended. Contact your platform admin." },
      { status: 403 },
    );
  }

  await setSessionCookie({ kind: "staff", staffUserId: staff!.id, gymId: gym.id, role: staff!.role });

  return NextResponse.json({ ok: true, role: staff!.role });
}
