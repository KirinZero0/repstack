import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guestPassRequestSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";
import { hashIp } from "@/lib/memberSignup";
import { MAX_GUEST_REQUESTS_PER_GYM_HOUR, MAX_GUEST_REQUESTS_PER_IP_HOUR } from "@/lib/guestPass";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Public: a non-member asks for a spot in one class session. Files a request only — nothing is
 * sent and no seat is held until staff approves it. Unauthenticated, so the gym comes from the URL
 * slug and the session must belong to that gym.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json({ error: "This gym isn't taking requests right now." }, { status: 403 });
  }

  const parsed = guestPassRequestSchema.safeParse(await req.json().catch(() => null));
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

  // Tenant isolation: only an upcoming, scheduled session of this gym's active class.
  const cs = await prisma.classSession.findUnique({ where: { id: d.sessionId }, include: { class: true } });
  if (!cs || cs.gymId !== gym.id || cs.status !== "SCHEDULED" || cs.startsAt <= new Date() || !cs.class.isActive) {
    return NextResponse.json({ error: "That class isn't available. Pick another." }, { status: 400 });
  }

  const phone = normalizePhone(d.phone);
  if (phone.length < 8) return NextResponse.json({ error: "Enter a valid WhatsApp number" }, { status: 400 });
  const lookup = hmacLookup(phone);

  // One request per phone per session; the same wording whether it is waiting, approved or declined.
  const existing = await prisma.guestPass.findUnique({ where: { sessionId_phoneWhatsappLookup: { sessionId: cs.id, phoneWhatsappLookup: lookup } } });
  if (existing) {
    return NextResponse.json({ error: "A request for this class with that number already exists. The gym will WhatsApp you once it's reviewed." }, { status: 409 });
  }

  await prisma.guestPass.create({
    data: { gymId: gym.id, sessionId: cs.id, fullName: d.fullName, phoneWhatsapp: encrypt(d.phone), phoneWhatsappLookup: lookup, ipHash },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
