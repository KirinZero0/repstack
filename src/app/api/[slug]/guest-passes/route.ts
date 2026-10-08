import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { putPrivateFile } from "@/lib/blob";
import { proofFileError } from "@/lib/transferProof";
import { DAY_PASS_MAX_DAYS_AHEAD, guestPassRequestSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";
import { dayKeyInTimezone } from "@/lib/date";
import { hashIp } from "@/lib/memberSignup";
import { MAX_GUEST_REQUESTS_PER_GYM_HOUR, MAX_GUEST_REQUESTS_PER_IP_HOUR } from "@/lib/guestPass";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Public: a non-member asks for a spot in one class session, or a day pass for a chosen day. Files a request only — nothing is
 * sent and no seat is held until staff approves it. Unauthenticated, so the gym comes from the URL
 * slug and the session must belong to that gym.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json({ error: "This gym isn't taking requests right now." }, { status: 403 });
  }

  // The request forms send multipart (so they can attach a transfer proof); plain JSON works too.
  let raw: unknown;
  let proof: File | null = null;
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    const field = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    raw = { sessionId: field("sessionId"), dayPassPlanId: field("dayPassPlanId"), visitDate: field("visitDate"), fullName: field("fullName"), phone: field("phone") };
    const f = form.get("proof");
    const bad = proofFileError(f);
    if (bad) return bad;
    if (f instanceof File && f.size > 0) proof = f;
  } else {
    raw = await req.json().catch(() => null);
  }
  const parsed = guestPassRequestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });
  const d = parsed.data;

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const ipHash = hashIp(clientIp(req));
  const [ipCount, gymCount] = await Promise.all([
    prisma.guestPass.count({ where: { ipHash, createdAt: { gte: hourAgo } } }),
    prisma.guestPass.count({ where: { gymId: gym.id, createdAt: { gte: hourAgo } } }),
  ]);
  if (ipCount >= MAX_GUEST_REQUESTS_PER_IP_HOUR || gymCount >= MAX_GUEST_REQUESTS_PER_GYM_HOUR) {
    return NextResponse.json({ error: "Too many requests. Please try again in a while." }, { status: 429 });
  }

  const phone = normalizePhone(d.phone);
  if (phone.length < 8) return NextResponse.json({ error: "Enter a valid WhatsApp number" }, { status: 400 });
  const lookup = hmacLookup(phone);
  const alreadyAsked = NextResponse.json(
    { error: "A request for this with that number already exists. The gym will WhatsApp you once it's reviewed." },
    { status: 409 },
  );

  let target: { sessionId: string; amount: Prisma.Decimal } | { dayPassPlanId: string; visitDate: string; amount: Prisma.Decimal };
  if (d.sessionId) {
    // Tenant isolation: only an upcoming, scheduled session of this gym's active class.
    const cs = await prisma.classSession.findUnique({ where: { id: d.sessionId }, include: { class: true } });
    if (!cs || cs.gymId !== gym.id || cs.status !== "SCHEDULED" || cs.startsAt <= new Date() || !cs.class.isActive) {
      return NextResponse.json({ error: "That class isn't available. Pick another." }, { status: 400 });
    }
    // One request per phone per session; the same wording whether it is waiting, approved or declined.
    if (await prisma.guestPass.findUnique({ where: { sessionId_phoneWhatsappLookup: { sessionId: cs.id, phoneWhatsappLookup: lookup } } })) return alreadyAsked;
    target = { sessionId: cs.id, amount: cs.class.price };
  } else {
    // Tenant isolation: only an active day-pass plan of this gym, for today or a near-future day in the gym's timezone.
    const plan = await prisma.dayPassPlan.findUnique({ where: { id: d.dayPassPlanId! } });
    if (!plan || plan.gymId !== gym.id || !plan.isActive) {
      return NextResponse.json({ error: "That day pass isn't available. Pick another." }, { status: 400 });
    }
    const today = dayKeyInTimezone(new Date(), gym.timezone);
    const last = dayKeyInTimezone(new Date(Date.now() + DAY_PASS_MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000), gym.timezone);
    const visitDate = d.visitDate!;
    if (visitDate < today || visitDate > last || Number.isNaN(Date.parse(visitDate))) {
      return NextResponse.json({ error: "Pick a day from today up to two weeks ahead." }, { status: 400 });
    }
    if (await prisma.guestPass.findUnique({ where: { dayPassPlanId_visitDate_phoneWhatsappLookup: { dayPassPlanId: plan.id, visitDate, phoneWhatsappLookup: lookup } } })) return alreadyAsked;
    target = { dayPassPlanId: plan.id, visitDate, amount: plan.price };
  }

  // Proof is optional and only means something when there is something to pay; a storage hiccup must not block the request.
  let proofImageUrl: string | undefined;
  if (proof && Number(target.amount) > 0) {
    try {
      proofImageUrl = await putPrivateFile(`guest-proofs/${gym.id}-${Date.now()}`, proof, proof.type);
    } catch (err) {
      console.error("Guest proof upload failed, continuing without it", err);
    }
  }

  await prisma.guestPass.create({
    data: {
      gymId: gym.id,
      ...target,
      fullName: d.fullName,
      phoneWhatsapp: encrypt(d.phone),
      phoneWhatsappLookup: lookup,
      ipHash,
      proofImageUrl,
      proofSubmittedAt: proofImageUrl ? new Date() : null,
    },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
