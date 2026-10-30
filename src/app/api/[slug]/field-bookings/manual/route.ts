import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { featureOff, gymHasFeature } from "@/lib/features";
import { manualFieldBookingSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";
import { bookingInstants, bookingPrice, parseClock, timeProblem } from "@/lib/fieldBooking";
import { fieldRules, HOLDING, isOverlapError } from "@/lib/fieldBookings";

/**
 * Owner or staff puts a booking straight on the calendar (someone phoned or walked in and paid at the counter),
 * or blocks the time for maintenance or an event. It is approved at once and takes its time on the field.
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

  if (!gymHasFeature(gym, "fieldBooking")) return featureOff("fieldBooking");

  const parsed = manualFieldBookingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
  const d = parsed.data;

  // Tenant isolation: the field must belong to the session's gym.
  const field = await db.field.findUnique({ where: { id: d.fieldId } });
  if (!field || field.gymId !== gym.id) return NextResponse.json({ error: "Field not found" }, { status: 404 });

  const startMin = parseClock(d.start);
  const endMin = parseClock(d.end);
  if (startMin === null || endMin === null) return NextResponse.json({ error: "Pick a start and an end time." }, { status: 400 });
  const rules = fieldRules(field);
  // Staff may log a booking that is already under way, so the "already started" rule is skipped for them.
  const problem = timeProblem(rules, d.date, startMin, endMin, gym.timezone, null);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const { startsAt, endsAt } = bookingInstants(d.date, startMin, endMin, gym.timezone);
  const clash = await db.fieldBooking.findFirst({
    where: { fieldId: field.id, status: { in: HOLDING }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    select: { id: true },
  });
  if (clash) return NextResponse.json({ error: "Another booking already holds that time." }, { status: 409 });

  const phone = d.phone ? normalizePhone(d.phone) : "";
  try {
    const created = await db.fieldBooking.create({
      data: {
        gymId: gym.id,
        fieldId: field.id,
        startsAt,
        endsAt,
        fullName: d.isBlock ? d.fullName || "Blocked" : d.fullName!,
        phoneWhatsapp: encrypt(d.phone ?? ""),
        phoneWhatsappLookup: hmacLookup(phone || "none"),
        status: "APPROVED",
        amount: d.isBlock ? 0 : bookingPrice(rules.pricePerHour, endMin - startMin),
        isBlock: d.isBlock,
        note: d.note || null,
        reviewedAt: new Date(),
        reviewedById: session.staffUserId,
      },
    });
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    if (isOverlapError(err)) return NextResponse.json({ error: "Another booking already holds that time." }, { status: 409 });
    throw err;
  }
}
