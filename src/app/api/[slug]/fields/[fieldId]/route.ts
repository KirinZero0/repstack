import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { featureOff, gymHasFeature } from "@/lib/features";
import { updateFieldSchema } from "@/lib/validation/tenant";
import { hoursProblem, parseClock } from "@/lib/fieldBooking";

async function owner(slug: string) {
  try {
    const t = await requireTenantSession(slug);
    if (t.session.role !== "OWNER") return { error: NextResponse.json({ error: "Only the owner can change fields" }, { status: 403 }) };
    return { t };
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return { error: NextResponse.json({ error: err.message }, { status }) };
    }
    throw err;
  }
}

/** Owner edits a field: name, price, hours, step, or switches it off. Existing bookings keep their own price. */
export async function PATCH(req: NextRequest, { params }: { params: { slug: string; fieldId: string } }) {
  const o = await owner(params.slug);
  if (o.error) return o.error;
  const { gym, db } = o.t!;
  if (!gymHasFeature(gym, "fieldBooking")) return featureOff("fieldBooking");

  const parsed = updateFieldSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
  const d = parsed.data;

  // Tenant isolation: the field must belong to the session's gym.
  const field = await db.field.findUnique({ where: { id: params.fieldId } });
  if (!field || field.gymId !== gym.id) return NextResponse.json({ error: "Field not found" }, { status: 404 });

  const opensAt = d.opensAt !== undefined ? parseClock(d.opensAt) : field.opensAt;
  const closesAt = d.closesAt !== undefined ? parseClock(d.closesAt) : field.closesAt;
  if (opensAt === null || closesAt === null) return NextResponse.json({ error: "Use times like 08:00." }, { status: 400 });
  const step = d.stepMinutes ?? field.stepMinutes;
  const problem = hoursProblem(opensAt, closesAt, step);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  await db.field.update({
    where: { id: field.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.sport !== undefined ? { sport: d.sport } : {}),
      ...(d.pricePerHour !== undefined ? { pricePerHour: d.pricePerHour } : {}),
      // Changing how a field is priced only affects new bookings; existing ones keep the rate they were made at.
      ...(d.pricingType !== undefined ? { pricingType: d.pricingType } : {}),
      ...(d.maxPax !== undefined ? { maxPax: d.maxPax } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      opensAt,
      closesAt,
      stepMinutes: step,
    },
  });
  return NextResponse.json({ ok: true });
}

/** Owner removes a field that has no bookings at all; one with a history is switched off instead. */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; fieldId: string } }) {
  const o = await owner(params.slug);
  if (o.error) return o.error;
  const { gym, db } = o.t!;
  const field = await db.field.findUnique({ where: { id: params.fieldId } });
  if (!field || field.gymId !== gym.id) return NextResponse.json({ error: "Field not found" }, { status: 404 });
  if ((await db.fieldBooking.count({ where: { fieldId: field.id } })) > 0) {
    return NextResponse.json({ error: "This field has bookings, so it can't be deleted. Switch it off instead." }, { status: 409 });
  }
  await db.field.delete({ where: { id: field.id } });
  return NextResponse.json({ ok: true });
}
