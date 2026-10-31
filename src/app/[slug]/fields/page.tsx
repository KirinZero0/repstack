import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt, maskEmail, maskPhone } from "@/lib/crypto";
import { dayKeyInTimezone } from "@/lib/date";
import { bookingInstants, bookingWindow, clock, isDateKey } from "@/lib/fieldBooking";
import GymNav from "@/components/GymNav";
import { paidByBooking } from "@/lib/fieldBookings";
import { gymHasFeature } from "@/lib/features";
import FieldsManager, { type BookingRow, type FieldRow } from "./FieldsManager";

export const dynamic = "force-dynamic";

/** Owner and staff: set up fields (owner), see a day's bookings on a timeline, and approve requests. */
export default async function FieldsPage({ params, searchParams }: { params: { slug: string }; searchParams: { date?: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  if (!gymHasFeature(gym, "fieldBooking")) {
    return (
      <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="gym-head mb-8 flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">Fields</h1>
            <GymNav slug={params.slug} role={session.role} current="dashboard" features={gym.features} />
          </div>
          <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-300" data-testid="feature-off">
            Field booking isn&apos;t enabled for {gym.name}. Ask Liftmora to turn it on.
          </p>
        </div>
      </main>
    );
  }

  const today = dayKeyInTimezone(new Date(), gym.timezone);
  const date = searchParams.date && isDateKey(searchParams.date) ? searchParams.date : today;
  const dayStart = bookingInstants(date, 0, 0, gym.timezone).startsAt;
  const dayEnd = new Date(dayStart.getTime() + 25 * 3600 * 1000);

  const [fields, dayBookings, pending] = await Promise.all([
    db.field.findMany({ where: { gymId: gym.id }, orderBy: { name: "asc" } }),
    db.fieldBooking.findMany({
      where: { gymId: gym.id, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart }, status: { in: ["APPROVED", "ATTENDED", "NO_SHOW"] } },
      orderBy: { startsAt: "asc" },
    }),
    db.fieldBooking.findMany({
      where: { gymId: gym.id, status: "PENDING_REVIEW", endsAt: { gt: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 100,
    }),
  ]);
  const paidMap = await paidByBooking(db, [...dayBookings, ...pending].map((b) => b.id));
  const fieldName = new Map(fields.map((f) => [f.id, f.name]));
  const minutesOfDay = (d: Date) => Math.round((d.getTime() - dayStart.getTime()) / 60000);

  const toRow = (b: (typeof dayBookings)[number]): BookingRow => ({
    id: b.id,
    fieldId: b.fieldId,
    fieldName: fieldName.get(b.fieldId) ?? "",
    fullName: b.fullName,
    phone: b.phoneWhatsapp ? maskPhone(decrypt(b.phoneWhatsapp)) : "",
    email: b.email ? maskEmail(decrypt(b.email)) : null,
    date: dayKeyInTimezone(b.startsAt, gym.timezone),
    start: minutesOfDay(b.startsAt),
    end: minutesOfDay(b.endsAt),
    startLabel: new Intl.DateTimeFormat("en-GB", { timeZone: gym.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(b.startsAt),
    endLabel: new Intl.DateTimeFormat("en-GB", { timeZone: gym.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(b.endsAt),
    amount: Number(b.amount),
    pax: b.pax,
    paid: paidMap.get(b.id) ?? 0,
    status: b.status,
    isBlock: b.isBlock,
    note: b.note,
    hasProof: Boolean(b.proofImageUrl),
    window: bookingWindow(b),
    hasContact: Boolean(b.email) || Boolean(b.phoneWhatsapp),
  });

  const fieldRows: FieldRow[] = fields.map((f) => ({
    id: f.id,
    name: f.name,
    sport: f.sport,
    pricePerHour: Number(f.pricePerHour),
    pricingType: f.pricingType,
    maxPax: f.maxPax,
    opensAt: f.opensAt,
    closesAt: f.closesAt,
    stepMinutes: f.stepMinutes,
    isActive: f.isActive,
    opensLabel: clock(f.opensAt),
    closesLabel: clock(f.closesAt),
  }));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="gym-head mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Fields</h1>
            <p className="text-sm text-neutral-400">
              Courts and pitches people book by the hour. A booking takes its time once you approve it. Public booking page: <a className="underline underline-offset-2" href={`/${params.slug}/book`}>/{params.slug}/book</a>
            </p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="fields" features={gym.features} />
        </div>
        <FieldsManager
          slug={params.slug}
          isOwner={session.role === "OWNER"}
          date={date}
          today={today}
          fields={fieldRows}
          dayBookings={dayBookings.map(toRow)}
          pending={pending.map((b) => ({ ...toRow(b), start: 0, end: 0, date: dayKeyInTimezone(b.startsAt, gym.timezone) }))}
        />
      </div>
    </main>
  );
}
