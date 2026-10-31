import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { featureOff, gymHasFeature } from "@/lib/features";
import { fieldSchema } from "@/lib/validation/tenant";
import { hoursProblem, parseClock } from "@/lib/fieldBooking";

/** Owner adds a bookable field. */
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
  if (session.role !== "OWNER") return NextResponse.json({ error: "Only the owner can set up fields" }, { status: 403 });

  if (!gymHasFeature(gym, "fieldBooking")) return featureOff("fieldBooking");

  const parsed = fieldSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
  const d = parsed.data;
  const opensAt = parseClock(d.opensAt);
  const closesAt = parseClock(d.closesAt);
  if (opensAt === null || closesAt === null) return NextResponse.json({ error: "Use times like 08:00." }, { status: 400 });
  if (d.pricingType === "PER_PAX" && d.minPax && d.maxPax && d.minPax > d.maxPax) {
    return NextResponse.json({ error: "The fewest people can't be more than the most." }, { status: 400 });
  }
  const problem = hoursProblem(opensAt, closesAt, d.stepMinutes);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const field = await db.field.create({
    data: { gymId: gym.id, name: d.name, sport: d.sport, pricePerHour: d.pricePerHour, pricingType: d.pricingType, maxPax: d.pricingType === "PER_PAX" ? d.maxPax ?? null : null, minPax: d.pricingType === "PER_PAX" ? d.minPax ?? null : null, opensAt, closesAt, stepMinutes: d.stepMinutes, isActive: d.isActive ?? true },
  });
  return NextResponse.json({ id: field.id }, { status: 201 });
}
