import { prisma } from "./prisma";
import { sendPlatformWhatsapp } from "./whatsapp";

export const SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;

/** Slugs that would collide with real routes or read as official. */
export const RESERVED_SLUGS = new Set([
  "api", "g", "demo", "signup", "superadmin", "activate", "my", "my-qr", "check-in", "login",
  "admin", "app", "www", "iron-ledger", "ironledger", "support", "billing", "pricing", "static",
]);

/**
 * Turns a paid signup into a real gym: Gym + owner StaffUser + the PAID subscription record,
 * atomically. Safe to call twice — anything but a PENDING signup is left alone.
 */
export async function completeSignup(signupId: string, invoice: { paidAt: Date; externalInvoiceId?: string | null }) {
  const signup = await prisma.gymSignup.findUnique({ where: { id: signupId }, include: { saasPlan: true } });
  if (!signup || signup.status !== "PENDING") return;

  // The slug/email may have been claimed since the form was submitted (e.g. by superadmin).
  const [slugTaken, emailTaken] = await Promise.all([
    prisma.gym.findUnique({ where: { slug: signup.slug } }),
    prisma.staffUser.findUnique({ where: { email: signup.ownerEmail } }),
  ]);
  if (slugTaken || emailTaken) {
    await prisma.gymSignup.update({ where: { id: signup.id }, data: { status: "CONFLICT" } });
    console.error(`Signup ${signup.id} was paid but its ${slugTaken ? "slug" : "email"} is already taken; needs manual follow-up`);
    return;
  }

  const days = signup.saasPlan.billingInterval === "annual" ? 365 : 30;
  const nextBillingDate = new Date(invoice.paidAt.getTime() + days * 24 * 60 * 60 * 1000);

  const gym = await prisma.$transaction(async (tx) => {
    const gym = await tx.gym.create({
      data: {
        name: signup.gymName,
        slug: signup.slug,
        saasPlanId: signup.saasPlanId,
        subscriptionStatus: "ACTIVE",
        nextBillingDate,
      },
    });
    await tx.staffUser.create({
      data: {
        gymId: gym.id,
        name: signup.ownerName,
        email: signup.ownerEmail,
        phone: signup.ownerPhone,
        passwordHash: signup.passwordHash,
        role: "OWNER",
      },
    });
    await tx.platformPayment.create({
      data: {
        gymId: gym.id,
        saasPlanId: signup.saasPlanId,
        provider: "xendit",
        externalInvoiceId: invoice.externalInvoiceId ?? null,
        amount: signup.saasPlan.price,
        status: "PAID",
        paidAt: invoice.paidAt,
      },
    });
    await tx.gymSignup.update({
      where: { id: signup.id },
      data: { status: "COMPLETED", gymId: gym.id, completedAt: new Date() },
    });
    return gym;
  });

  if (signup.ownerPhone) {
    await sendPlatformWhatsapp({
      to: signup.ownerPhone,
      message: `Welcome to Iron Ledger, ${signup.ownerName}! "${gym.name}" is ready. Log in at ${process.env.NEXT_PUBLIC_APP_URL}/g/${gym.slug}/login with ${signup.ownerEmail} and the password you chose.`,
    }).catch((err) => console.error("Signup welcome message failed", err));
  }
}
