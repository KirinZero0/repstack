import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { joinSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";
import { countMemberSeats } from "@/lib/limits";
import { createXenditInvoice, getXenditInvoice, isMockMode } from "@/lib/xendit";
import {
  MAX_SIGNUPS_PER_GYM_HOUR,
  MAX_SIGNUPS_PER_IP_HOUR,
  MEMBER_SIGNUP_TTL_MS,
  gymAcceptsSignups,
  hashIp,
} from "@/lib/memberSignup";

function fieldError(field: string, message: string, status = 409) {
  return NextResponse.json({ error: message, field }, { status });
}

function clientIp(req: NextRequest): string {
  // On Vercel the first x-forwarded-for entry is the real client; locally it's usually absent.
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Public: someone joins a gym online. Stores a pending signup and returns the invoice to pay. */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED" || !gymAcceptsSignups(gym.settings)) {
    return NextResponse.json({ error: "This gym isn't taking online sign-ups right now. Please ask at the front desk." }, { status: 403 });
  }

  const parsed = joinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fieldError(String(issue.path[0] ?? "form"), issue.message, 400);
  }
  const d = parsed.data;

  // Throttle: every attempt creates a signup row and possibly a Xendit invoice.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const ipHash = hashIp(clientIp(req));
  const [ipCount, gymCount] = await Promise.all([
    prisma.memberSignup.count({ where: { ipHash, createdAt: { gte: hourAgo } } }),
    prisma.memberSignup.count({ where: { gymId: gym.id, createdAt: { gte: hourAgo } } }),
  ]);
  if (ipCount >= MAX_SIGNUPS_PER_IP_HOUR || gymCount >= MAX_SIGNUPS_PER_GYM_HOUR) {
    return NextResponse.json({ error: "Too many sign-up attempts. Please try again in a while." }, { status: 429 });
  }

  // Tenant isolation: only plans of this gym that are on sale.
  const plan = await prisma.membershipPlan.findUnique({ where: { id: d.planId } });
  if (!plan || plan.gymId !== gym.id || !plan.isActive) return fieldError("planId", "That plan isn't available. Pick another.", 400);

  // A gym on a full plan can't take more people. Don't expose the numbers to the public.
  const [saasPlan, seats] = await Promise.all([
    prisma.saasPlan.findUnique({ where: { id: gym.saasPlanId } }),
    countMemberSeats(prisma, gym.id),
  ]);
  if (saasPlan && seats >= saasPlan.maxMembers) {
    return NextResponse.json({ error: "This gym isn't taking new members right now. Please ask at the front desk." }, { status: 403 });
  }

  // Member.email is unique across every gym, so this can also mean "member of another gym".
  // The wording is deliberately the same for both.
  if (await prisma.member.findUnique({ where: { email: d.email } })) {
    return fieldError("email", "This email can't be used to join. If you already have an account, log in instead.");
  }

  const holding = await prisma.memberSignup.findFirst({
    where: { email: d.email, status: "PENDING", createdAt: { gte: new Date(Date.now() - MEMBER_SIGNUP_TTL_MS) } },
    orderBy: { createdAt: "desc" },
  });

  try {
    if (holding && (holding.gymId !== gym.id || holding.planId !== plan.id)) {
      return fieldError("email", "You already started joining with this email. Use the same details to continue, or try again tomorrow.");
    }
    if (holding?.externalInvoiceId) {
      const existing = await getXenditInvoice(holding.externalInvoiceId);
      if (existing && existing.status === "PENDING") {
        return NextResponse.json({ signupId: holding.id, invoiceUrl: invoiceLink(params.slug, holding.id, existing.invoice_url) });
      }
    }

    const phone = normalizePhone(d.phone);
    const signup =
      holding ??
      (await prisma.memberSignup.create({
        data: {
          gymId: gym.id,
          planId: plan.id,
          fullName: d.fullName,
          email: d.email,
          phoneWhatsapp: encrypt(d.phone),
          phoneWhatsappLookup: hmacLookup(phone),
          passwordHash: await bcrypt.hash(d.password, 10),
          amount: plan.price,
          ipHash,
          termsAcceptedAt: new Date(),
        },
      }));

    const invoice = await createXenditInvoice({
      externalId: signup.id,
      amount: Number(signup.amount),
      payerEmail: d.email,
      description: `${plan.name} membership — ${gym.name}`,
      currency: plan.currency,
      successRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/g/${gym.slug}/join/success?id=${signup.id}`,
    });
    await prisma.memberSignup.update({ where: { id: signup.id }, data: { externalInvoiceId: invoice.id } });

    return NextResponse.json({ signupId: signup.id, invoiceUrl: invoiceLink(params.slug, signup.id, invoice.invoice_url) });
  } catch (err) {
    console.error("Member signup failed to create an invoice", err);
    return NextResponse.json({ error: "We couldn't start the payment. Please try again in a moment." }, { status: 502 });
  }
}

/** In dev mock mode there's no Xendit page, so use our own test checkout on the success page. */
function invoiceLink(slug: string, signupId: string, url: string) {
  return isMockMode() ? `/g/${slug}/join/success?id=${signupId}` : url;
}
