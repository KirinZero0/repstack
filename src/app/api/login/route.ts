import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";
import { staffLoginSchema } from "@/lib/validation/tenant";
import { compareOrDummy } from "@/lib/passwordTiming";
import { suspendedForNonPayment } from "@/lib/suspension";

/**
 * One login for the whole platform: no gym address to remember or type. Email is unique across
 * every StaffUser and every Member (schema constraints), so it alone finds the one account and its
 * gym — same constant-time double-compare as /api/[slug]/login, so timing can't reveal whether the
 * email exists or which table it's in. If the same email is both a StaffUser and a Member (allowed,
 * separate unique constraints, presumably at different gyms today since multi-gym-per-person isn't
 * supported yet), staff takes precedence, same as the per-gym login.
 */
export async function POST(req: NextRequest) {
  const parsed = staffLoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const [staff, member] = await Promise.all([
    prisma.staffUser.findUnique({ where: { email }, include: { gym: true } }),
    prisma.member.findUnique({ where: { email }, include: { gym: true } }),
  ]);
  const staffBelongs = Boolean(staff && staff.isActive);
  const memberBelongs = Boolean(member && member.passwordHash);

  const [staffValid, memberValid] = await Promise.all([
    compareOrDummy(password, staffBelongs ? staff!.passwordHash : null),
    compareOrDummy(password, memberBelongs ? member!.passwordHash : null),
  ]);

  if (staffBelongs && staffValid) {
    const gym = staff!.gym;
    // An owner of a gym suspended for non-payment gets in, but only to the billing page (see requireTenantSession).
    const ownerMayPay = staff!.role === "OWNER" && gym.subscriptionStatus === "SUSPENDED" && suspendedForNonPayment(gym.settings);
    if (ownerMayPay) {
      await setSessionCookie({ kind: "staff", staffUserId: staff!.id, gymId: gym.id, role: staff!.role });
      return NextResponse.json({ ok: true, kind: "staff", role: staff!.role, slug: gym.slug, billingOnly: true });
    }
    if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
      return NextResponse.json(
        { error: "This gym's account is suspended. Contact your platform admin." },
        { status: 403 },
      );
    }
    await setSessionCookie({ kind: "staff", staffUserId: staff!.id, gymId: gym.id, role: staff!.role });
    return NextResponse.json({ ok: true, kind: "staff", role: staff!.role, slug: gym.slug });
  }

  if (memberBelongs && memberValid) {
    const gym = member!.gym;
    if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
      return NextResponse.json(
        { error: "This gym's account is suspended. Contact your platform admin." },
        { status: 403 },
      );
    }
    await setSessionCookie({ kind: "member", memberId: member!.id, gymId: gym.id });
    return NextResponse.json({ ok: true, kind: "member", slug: gym.slug });
  }

  return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
}
