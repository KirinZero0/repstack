import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { busyRanges, freeRanges, isDateKey } from "@/lib/fieldBooking";
import { bookingInstants } from "@/lib/fieldBooking";
import { fieldRules, HOLDING } from "@/lib/fieldBookings";

/**
 * Public: when a field is free on a date. Returns only time ranges, never who booked, so it is safe to show
 * anyone. Only approved bookings (and staff blocks) take time; a request that is still pending doesn't.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string; fieldId: string } }) {
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!isDateKey(date)) return NextResponse.json({ error: "Pick a date." }, { status: 400 });

  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  // Tenant isolation: the field must belong to the gym in the URL.
  const field = await prisma.field.findUnique({ where: { id: params.fieldId } });
  if (!field || field.gymId !== gym.id || !field.isActive) return NextResponse.json({ error: "Field not found" }, { status: 404 });

  const dayStart = bookingInstants(date, 0, 0, gym.timezone).startsAt;
  const dayEnd = new Date(dayStart.getTime() + 26 * 3600 * 1000); // a day plus slack for a longer local day
  const held = await prisma.fieldBooking.findMany({
    where: { fieldId: field.id, status: { in: HOLDING }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
    select: { startsAt: true, endsAt: true },
  });
  const rules = fieldRules(field);
  const busy = busyRanges(held, date, gym.timezone);
  return NextResponse.json({
    opensAt: rules.opensAt,
    closesAt: rules.closesAt,
    stepMinutes: rules.stepMinutes,
    pricePerHour: rules.pricePerHour,
    busy,
    free: freeRanges(rules, busy),
  });
}
