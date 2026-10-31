import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { featureOff, gymHasFeature } from "@/lib/features";
import { putPrivateFile } from "@/lib/blob";
import { proofFileError } from "@/lib/transferProof";
import { fieldBookingRequestSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";
import { hashIp } from "@/lib/memberSignup";
import { bookingAmount, bookingInstants, parseClock, timeProblem } from "@/lib/fieldBooking";
import { fieldRules, HOLDING, MAX_BOOKING_REQUESTS_PER_GYM_HOUR, MAX_BOOKING_REQUESTS_PER_IP_HOUR, sendBookingReceived } from "@/lib/fieldBookings";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Public: someone asks for a stretch of time on a field. Files a request only: nothing is held until staff
 * approve it, so several people can ask for the same time. Unauthenticated, so the gym comes from the URL slug
 * and the field must belong to it.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  if (!gymHasFeature(gym, "fieldBooking")) return featureOff("fieldBooking", true);
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json({ error: "This gym isn't taking bookings right now." }, { status: 403 });
  }

  // The form sends multipart so a transfer proof can be attached; plain JSON works too.
  let raw: unknown;
  let proof: File | null = null;
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    const text = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    raw = { fieldId: text("fieldId"), date: text("date"), start: text("start"), end: text("end"), pax: text("pax") === undefined ? undefined : Number(text("pax")), fullName: text("fullName"), phone: text("phone"), email: text("email") };
    const f = form.get("proof");
    const bad = proofFileError(f);
    if (bad) return bad;
    if (f instanceof File && f.size > 0) proof = f;
  } else {
    raw = await req.json().catch(() => null);
  }
  const parsed = fieldBookingRequestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });
  const d = parsed.data;

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const ipHash = hashIp(clientIp(req));
  const [ipCount, gymCount] = await Promise.all([
    prisma.fieldBooking.count({ where: { ipHash, createdAt: { gte: hourAgo } } }),
    prisma.fieldBooking.count({ where: { gymId: gym.id, createdAt: { gte: hourAgo } } }),
  ]);
  if (ipCount >= MAX_BOOKING_REQUESTS_PER_IP_HOUR || gymCount >= MAX_BOOKING_REQUESTS_PER_GYM_HOUR) {
    return NextResponse.json({ error: "Too many requests. Please try again in a while." }, { status: 429 });
  }

  const phone = normalizePhone(d.phone);
  if (phone.length < 8) return NextResponse.json({ error: "Enter a valid WhatsApp number" }, { status: 400 });

  // Tenant isolation: only an active field of this gym.
  const field = await prisma.field.findUnique({ where: { id: d.fieldId } });
  if (!field || field.gymId !== gym.id || !field.isActive) return NextResponse.json({ error: "That field isn't available. Pick another." }, { status: 400 });

  // A per-person field needs to know how many people; a per-field one ignores it.
  const perPax = field.pricingType === "PER_PAX";
  if (perPax && d.pax === undefined) return NextResponse.json({ error: "Enter how many people." }, { status: 400 });
  if (perPax && field.maxPax !== null && d.pax! > field.maxPax) {
    return NextResponse.json({ error: `This field takes up to ${field.maxPax} people. Ask at the front desk for a bigger group.` }, { status: 400 });
  }
  const pax = perPax ? d.pax! : null;

  const startMin = parseClock(d.start);
  const endMin = parseClock(d.end);
  if (startMin === null || endMin === null) return NextResponse.json({ error: "Pick a start and an end time." }, { status: 400 });
  const rules = fieldRules(field);
  const problem = timeProblem(rules, d.date, startMin, endMin, gym.timezone);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const { startsAt, endsAt } = bookingInstants(d.date, startMin, endMin, gym.timezone);
  const taken = await prisma.fieldBooking.findFirst({
    where: { fieldId: field.id, status: { in: HOLDING }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    select: { id: true },
  });
  if (taken) return NextResponse.json({ error: "That time is already booked. Pick another." }, { status: 409 });

  const lookup = hmacLookup(phone);
  const open = await prisma.fieldBooking.findFirst({
    where: { fieldId: field.id, phoneWhatsappLookup: lookup, startsAt, status: { in: ["PENDING_REVIEW", "APPROVED"] } },
    select: { id: true },
  });
  if (open) return NextResponse.json({ error: "You already asked for this time. The gym will contact you once it's reviewed." }, { status: 409 });

  const amount = bookingAmount(field.pricingType, rules.pricePerHour, pax, endMin - startMin);
  // Proof is optional and only means something when there is something to pay; a storage hiccup must not block the request.
  let proofImageUrl: string | undefined;
  if (proof && amount > 0) {
    try {
      proofImageUrl = await putPrivateFile(`booking-proofs/${gym.id}-${Date.now()}`, proof, proof.type);
    } catch (err) {
      console.error("Booking proof upload failed, continuing without it", err);
    }
  }

  const created = await prisma.fieldBooking.create({
    data: {
      gymId: gym.id,
      fieldId: field.id,
      startsAt,
      endsAt,
      fullName: d.fullName,
      phoneWhatsapp: encrypt(d.phone),
      phoneWhatsappLookup: lookup,
      email: encrypt(d.email),
      pax,
      rate: rules.pricePerHour,
      amount,
      ipHash,
      proofImageUrl,
      proofSubmittedAt: proofImageUrl ? new Date() : null,
    },
  });
  waitUntil(sendBookingReceived(created.id));
  return NextResponse.json({ ok: true, amount }, { status: 201 });
}
