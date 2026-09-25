import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { createStaffSchema } from "@/lib/validation/tenant";
import { createPasswordReset, deliverResetLink, resetUrl, unusablePasswordHash } from "@/lib/passwordReset";

/** Owner adds a staff account. The staff member sets their own password through a one-time link. */
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
    return NextResponse.json({ error: "Only the owner can add staff" }, { status: 403 });
  }

  const parsed = createStaffSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: "Check the name and email and try again.", field: String(issue.path[0] ?? "form") }, { status: 400 });
  }
  const d = parsed.data;

  const plan = await prisma.saasPlan.findUnique({ where: { id: gym.saasPlanId } });
  const activeStaff = await prisma.staffUser.count({ where: { gymId: gym.id, isActive: true } });
  if (plan && activeStaff >= plan.maxStaff) {
    return NextResponse.json(
      { error: `Your ${plan.name} plan allows ${plan.maxStaff} staff accounts, including you. Deactivate someone or upgrade to add more.` },
      { status: 403 },
    );
  }

  // StaffUser.email is unique across every gym, so keep the message the same either way.
  if (await prisma.staffUser.findUnique({ where: { email: d.email } })) {
    return NextResponse.json({ error: "That email can't be used for a staff account.", field: "email" }, { status: 409 });
  }

  const staff = await prisma.staffUser.create({
    data: {
      gymId: gym.id,
      name: d.name,
      email: d.email,
      phone: d.phone,
      passwordHash: await unusablePasswordHash(),
      role: "STAFF",
    },
  });

  const token = await createPasswordReset({ kind: "staff", subjectId: staff.id, purpose: "invite" });
  waitUntil(deliverResetLink({ kind: "staff", name: staff.name, token, purpose: "invite", staffPhone: staff.phone, gymName: gym.name }));

  // The owner sees the link once so they can hand it over in person if WhatsApp isn't an option.
  return NextResponse.json({ staffId: staff.id, inviteUrl: resetUrl(token) }, { status: 201 });
}
