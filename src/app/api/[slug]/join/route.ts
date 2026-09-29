import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { putPrivateFile } from "@/lib/blob";
import { joinSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";
import { countMemberSeats } from "@/lib/limits";
import {
  MAX_SIGNUPS_PER_GYM_HOUR,
  MAX_SIGNUPS_PER_IP_HOUR,
  MEMBER_SIGNUP_TTL_MS,
  gymAcceptsSignups,
  hashIp,
} from "@/lib/memberSignup";

const MAX_PROOF_BYTES = 2 * 1024 * 1024;
const ALLOWED_PROOF_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function fieldError(field: string, message: string, status = 409) {
  return NextResponse.json({ error: message, field }, { status });
}

function clientIp(req: NextRequest): string {
  // On Vercel the first x-forwarded-for entry is the real client; locally it's usually absent.
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Public: someone joins a gym online. Payment is a bank transfer straight to the gym's own
 * account (shown on the join page) — this only files a request, with an optional proof image,
 * for gym staff to confirm and approve.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED" || !gymAcceptsSignups(gym.settings)) {
    return NextResponse.json({ error: "This gym isn't taking online sign-ups right now. Please ask at the front desk." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return fieldError("form", "Invalid form data", 400);

  const parsed = joinSchema.safeParse({
    planId: form.get("planId"),
    fullName: form.get("fullName"),
    email: form.get("email"),
    phone: form.get("phone"),
    password: form.get("password"),
    acceptTerms: form.get("acceptTerms") === "true",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fieldError(String(issue.path[0] ?? "form"), issue.message, 400);
  }
  const d = parsed.data;

  const proof = form.get("proof");
  if (proof instanceof File && proof.size > 0) {
    if (!ALLOWED_PROOF_MIME.has(proof.type)) return fieldError("proof", "Proof image must be JPEG, PNG, or WebP", 400);
    if (proof.size > MAX_PROOF_BYTES) return fieldError("proof", "Proof image must be under 2MB", 400);
  }

  // Throttle: every attempt creates or updates a signup row.
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

  // Email must be unique among requests still waiting on staff review — an unauthenticated
  // resubmit must never be able to overwrite another request's password or contact details
  // (that would let anyone hijack a pending signup just by knowing the victim's email).
  const holding = await prisma.memberSignup.findFirst({
    where: { email: d.email, status: "PENDING_REVIEW", createdAt: { gte: new Date(Date.now() - MEMBER_SIGNUP_TTL_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (holding) {
    return fieldError("email", "A request with this email is already waiting for review. Ask the gym if you need to change it, or try again once it's been reviewed.");
  }

  let proofImageUrl: string | undefined;
  if (proof instanceof File && proof.size > 0) {
    // Proof is optional — never let a Blob failure block the request itself.
    try {
      proofImageUrl = await putPrivateFile(`join-proofs/${gym.id}-${Date.now()}`, proof, proof.type);
    } catch (err) {
      console.error("Proof image upload failed, continuing without it", err);
    }
  }

  const phone = normalizePhone(d.phone);
  const signup = await prisma.memberSignup.create({
    data: {
      gymId: gym.id,
      planId: plan.id,
      fullName: d.fullName,
      email: d.email,
      phoneWhatsapp: encrypt(d.phone),
      phoneWhatsappLookup: hmacLookup(phone),
      passwordHash: await bcrypt.hash(d.password, 10),
      amount: plan.price,
      status: "PENDING_REVIEW",
      proofImageUrl,
      ipHash,
      termsAcceptedAt: new Date(),
    },
  });

  return NextResponse.json({ signupId: signup.id });
}
