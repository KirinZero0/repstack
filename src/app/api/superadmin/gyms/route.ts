import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { createGymSchema } from "@/lib/validation/superadmin";
import { writeAuditLog } from "@/lib/audit";
import { sendPlatformWhatsapp } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = createGymSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const existingSlug = await prisma.gym.findUnique({ where: { slug: data.slug } });
  if (existingSlug) {
    return NextResponse.json({ error: "Slug already in use" }, { status: 409 });
  }
  const existingOwnerEmail = await prisma.staffUser.findUnique({ where: { email: data.ownerEmail } });
  if (existingOwnerEmail) {
    return NextResponse.json({ error: "Owner email already in use" }, { status: 409 });
  }

  const plan = await prisma.saasPlan.findUnique({ where: { id: data.saasPlanId } });
  if (!plan || !plan.isActive) {
    return NextResponse.json({ error: "Invalid SaaS plan" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(data.ownerTempPassword, 10);

  const nextBillingDate = data.isLifetime
    ? null
    : new Date(Date.now() + (plan.billingInterval === "annual" ? 365 : 30) * 24 * 60 * 60 * 1000);

  const { gym, owner } = await prisma.$transaction(async (tx) => {
    const gym = await tx.gym.create({
      data: {
        name: data.gymName,
        slug: data.slug,
        saasPlanId: data.saasPlanId,
        isLifetime: data.isLifetime,
        subscriptionStatus: "ACTIVE",
        nextBillingDate,
      },
    });

    const owner = await tx.staffUser.create({
      data: {
        gymId: gym.id,
        name: data.ownerName,
        email: data.ownerEmail,
        phone: data.ownerPhone,
        passwordHash,
        role: "OWNER",
      },
    });

    return { gym, owner };
  });

  await writeAuditLog({
    superadminId: session.superadminId,
    gymId: gym.id,
    action: "GYM_CREATED",
    metadata: { gymName: gym.name, slug: gym.slug, ownerEmail: owner.email, isLifetime: gym.isLifetime },
  });

  if (data.ownerPhone) {
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/g/${gym.slug}/login`;
    await sendPlatformWhatsapp({
      to: data.ownerPhone,
      message: `Welcome to Iron Ledger, ${data.ownerName}! Your gym "${data.gymName}" is set up. Log in at ${loginUrl} with email ${data.ownerEmail} and the temporary password you were given.`,
    });
  }

  return NextResponse.json({ gymId: gym.id, ownerId: owner.id }, { status: 201 });
}
