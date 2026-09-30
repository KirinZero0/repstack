import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";
import { staffLoginSchema } from "@/lib/validation/tenant";
import { compareOrDummy } from "@/lib/passwordTiming";
import { suspendedForNonPayment } from "@/lib/suspension";
import { checkLoginThrottle } from "@/lib/loginThrottle";

/**
 * One login form for both staff and members of a gym. Looks up both tables and runs a
 * bcrypt compare for each unconditionally (real hash or dummy) so response timing doesn't
 * reveal which table matched, whether the email exists, or which table it belongs to.
 *
 * If the same email happens to exist as both a StaffUser and a Member for this gym (allowed —
 * each table has its own unique constraint), staff takes precedence.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!(await checkLoginThrottle(req))) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const parsed = staffLoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) {
    return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  }

  const [staff, member] = await Promise.all([
    prisma.staffUser.findUnique({ where: { email } }),
    prisma.member.findUnique({ where: { email } }),
  ]);
  const staffBelongs = Boolean(staff && staff.gymId === gym.id && staff.isActive);
  const memberBelongs = Boolean(member && member.gymId === gym.id && member.passwordHash);

  const [staffValid, memberValid] = await Promise.all([
    compareOrDummy(password, staffBelongs ? staff!.passwordHash : null),
    compareOrDummy(password, memberBelongs ? member!.passwordHash : null),
  ]);

  if (staffBelongs && staffValid) {
    // An owner of a gym suspended for non-payment gets in, but only to the billing page (see requireTenantSession).
    const ownerMayPay = staff!.role === "OWNER" && gym.subscriptionStatus === "SUSPENDED" && suspendedForNonPayment(gym.settings);
    if (ownerMayPay) {
      await setSessionCookie({ kind: "staff", staffUserId: staff!.id, gymId: gym.id, role: staff!.role });
      return NextResponse.json({ ok: true, kind: "staff", role: staff!.role, billingOnly: true });
    }
    if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
      return NextResponse.json(
        { error: "This gym's account is suspended. Contact your platform admin." },
        { status: 403 },
      );
    }
    await setSessionCookie({ kind: "staff", staffUserId: staff!.id, gymId: gym.id, role: staff!.role });
    return NextResponse.json({ ok: true, kind: "staff", role: staff!.role });
  }

  if (memberBelongs && memberValid) {
    if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
      return NextResponse.json(
        { error: "This gym's account is suspended. Contact your platform admin." },
        { status: 403 },
      );
    }
    await setSessionCookie({ kind: "member", memberId: member!.id, gymId: gym.id });
    return NextResponse.json({ ok: true, kind: "member" });
  }

  return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
}
