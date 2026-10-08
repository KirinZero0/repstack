import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireTenantSession, SessionError } from "@/lib/session";
import { walkInSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";

/**
 * Owner or staff logs someone who buys a day pass at the desk. The pass is created already
 * ATTENDED (paid and admitted in one step), with the staff member as reviewer and scanner, so it
 * lands in finance and the guest list like any other day pass. No ticket or WhatsApp is sent.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }

  const parsed = walkInSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const d = parsed.data;

  // Tenant isolation: only an active day-pass plan of this gym.
  const plan = await db.dayPassPlan.findUnique({ where: { id: d.dayPassPlanId } });
  if (!plan || plan.gymId !== gym.id || !plan.isActive) return NextResponse.json({ error: "That day pass isn't available." }, { status: 400 });

  // The columns are required, so a walk-in without a number gets a unique placeholder lookup that can never match a real phone.
  const phone = d.phone ? normalizePhone(d.phone) : "";
  if (d.phone && phone.length < 8) return NextResponse.json({ error: "Enter a valid phone number or leave it blank." }, { status: 400 });

  const now = new Date();
  const pass = await db.guestPass.create({
    data: {
      gymId: gym.id,
      dayPassPlanId: plan.id,
      fullName: d.fullName,
      phoneWhatsapp: encrypt(d.phone ?? ""),
      phoneWhatsappLookup: hmacLookup(phone || `walk-in:${randomUUID()}`),
      amount: d.amount ?? plan.price,
      status: "ATTENDED",
      reviewedById: session.staffUserId,
      reviewedAt: now,
      attendedAt: now,
      scannedById: session.staffUserId,
    },
  });
  return NextResponse.json({ ok: true, id: pass.id }, { status: 201 });
}
