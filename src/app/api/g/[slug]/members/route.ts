import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { addMemberSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";
import { createMagicLink } from "@/lib/magicLink";
import { createXenditInvoice } from "@/lib/xendit";
import { sendGymWhatsapp } from "@/lib/whatsapp";

const ACTIVATION_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  let gym;
  try {
    ({ gym } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const existingEmail = await prisma.member.findUnique({ where: { email: data.email } });
  if (existingEmail) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const plan = await prisma.membershipPlan.findUnique({ where: { id: data.planId } });
  if (!plan || plan.gymId !== gym.id || !plan.isActive) {
    return NextResponse.json({ error: "Invalid membership plan" }, { status: 400 });
  }

  const member = await prisma.member.create({
    data: {
      gymId: gym.id,
      planId: plan.id,
      fullName: data.fullName,
      email: data.email,
      phoneWhatsapp: encrypt(data.phoneWhatsapp),
      phoneWhatsappLookup: hmacLookup(normalizePhone(data.phoneWhatsapp)),
      status: "PENDING_PAYMENT",
    },
  });

  const payment = await prisma.payment.create({
    data: {
      gymId: gym.id,
      memberId: member.id,
      planId: plan.id,
      provider: "XENDIT",
      amount: plan.price,
      currency: plan.currency,
      status: "PENDING",
    },
  });

  let invoiceUrl: string | null = null;
  try {
    const invoice = await createXenditInvoice({
      externalId: payment.id,
      amount: Number(plan.price),
      payerEmail: data.email,
      description: `${plan.name} membership — ${gym.name}`,
      currency: plan.currency,
      successRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/g/${gym.slug}/member-login`,
    });
    invoiceUrl = invoice.invoice_url;
    await prisma.payment.update({
      where: { id: payment.id },
      data: { externalInvoiceId: invoice.id },
    });
  } catch (err) {
    console.error("Xendit invoice creation failed", err);
  }

  const { token } = await createMagicLink({
    memberId: member.id,
    purpose: "activate",
    expiresInMs: ACTIVATION_LINK_TTL_MS,
  });
  const activationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/activate/${token}`;

  const messageParts = [
    `Hi ${data.fullName}! You've been added to ${gym.name}.`,
    `Activate your account and set a password here: ${activationUrl}`,
  ];
  if (invoiceUrl) {
    messageParts.push(`Complete your membership payment: ${invoiceUrl}`);
  }

  await sendGymWhatsapp(gym.id, {
    to: data.phoneWhatsapp,
    message: messageParts.join("\n"),
    type: "member_activation",
    memberId: member.id,
  });

  return NextResponse.json({ memberId: member.id }, { status: 201 });
}
