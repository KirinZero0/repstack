import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signupSchema } from "@/lib/validation/tenant";
import { RESERVED_SLUGS, SIGNUP_TTL_MS } from "@/lib/signup";
import { createXenditInvoice, getXenditInvoice, isMockMode } from "@/lib/xendit";

function fieldError(field: string, message: string, status = 409) {
  return NextResponse.json({ error: message, field }, { status });
}

/** Starts a self-serve signup: validates, stores it as pending, and returns the invoice to pay. */
export async function POST(req: NextRequest) {
  const parsed = signupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fieldError(String(issue.path[0] ?? "form"), issue.message, 400);
  }
  const d = parsed.data;

  if (RESERVED_SLUGS.has(d.slug)) return fieldError("slug", "That web address is reserved. Try another.");

  const plan = await prisma.saasPlan.findUnique({ where: { id: d.saasPlanId } });
  if (!plan || !plan.isActive) return fieldError("saasPlanId", "That plan isn't available", 400);

  const [gym, owner] = await Promise.all([
    prisma.gym.findUnique({ where: { slug: d.slug } }),
    prisma.staffUser.findUnique({ where: { email: d.ownerEmail } }),
  ]);
  if (gym) return fieldError("slug", "That web address is already taken. Try another.");
  if (owner) return fieldError("ownerEmail", "That email already runs a gym on Iron Ledger. Log in instead.");

  // Unpaid signups hold their slug and email for 24 hours.
  const recent = new Date(Date.now() - SIGNUP_TTL_MS);
  const holding = await prisma.gymSignup.findFirst({
    where: { status: "PENDING", createdAt: { gte: recent }, OR: [{ slug: d.slug }, { ownerEmail: d.ownerEmail }] },
    orderBy: { createdAt: "desc" },
  });

  try {
    if (holding) {
      const sameSignup = holding.slug === d.slug && holding.ownerEmail === d.ownerEmail && holding.saasPlanId === d.saasPlanId;
      if (!sameSignup) {
        return fieldError(
          holding.slug === d.slug ? "slug" : "ownerEmail",
          holding.slug === d.slug
            ? "Someone is finishing a signup with that web address. Try another."
            : "You already started a signup with this email. Use the same details to continue, or wait 24 hours.",
        );
      }
      // Same person retrying: resume their unpaid invoice rather than creating a second one.
      if (holding.externalInvoiceId) {
        const existing = await getXenditInvoice(holding.externalInvoiceId);
        if (existing && existing.status === "PENDING") {
          return NextResponse.json({ signupId: holding.id, invoiceUrl: signupInvoiceUrl(holding.id, existing.invoice_url) });
        }
      }
    }

    const signup =
      holding && holding.slug === d.slug && holding.ownerEmail === d.ownerEmail && holding.saasPlanId === d.saasPlanId
        ? holding
        : await prisma.gymSignup.create({
            data: {
              gymName: d.gymName,
              slug: d.slug,
              ownerName: d.ownerName,
              ownerEmail: d.ownerEmail,
              ownerPhone: d.ownerPhone,
              passwordHash: await bcrypt.hash(d.password, 10),
              saasPlanId: plan.id,
            },
          });

    const invoice = await createXenditInvoice({
      externalId: signup.id,
      amount: Number(plan.price),
      payerEmail: d.ownerEmail,
      description: `Iron Ledger ${plan.name}: ${d.gymName}`,
      currency: plan.currency,
      successRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/signup/success?id=${signup.id}`,
    });
    await prisma.gymSignup.update({ where: { id: signup.id }, data: { externalInvoiceId: invoice.id } });

    return NextResponse.json({ signupId: signup.id, invoiceUrl: signupInvoiceUrl(signup.id, invoice.invoice_url) });
  } catch (err) {
    console.error("Signup failed to create an invoice", err);
    return NextResponse.json({ error: "We couldn't start the payment. Please try again in a moment." }, { status: 502 });
  }
}

/** In dev mock mode there's no Xendit page, so send people to our own test checkout instead. */
function signupInvoiceUrl(signupId: string, url: string) {
  return isMockMode() ? `/signup/success?id=${signupId}` : url;
}
