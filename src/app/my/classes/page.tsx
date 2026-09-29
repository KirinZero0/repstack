import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { rp } from "@/components/charts";
import { memberPaymentsAvailable } from "@/lib/gateway";
import { SEAT_HOLDING_STATUSES, effectiveCapacity, whenLabel } from "@/lib/classes";
import { BookButton, CancelBookingButton } from "./ClassActions";

export const dynamic = "force-dynamic";

/** Members browse upcoming class sessions, book a seat, and manage their own bookings. */
export default async function MyClassesPage() {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <div className="text-center">
          <p className="mb-4 text-neutral-300">Log in as a member to see classes.</p>
          <a href="/" className="text-sm text-neutral-500 hover:text-neutral-300">← Back home</a>
        </div>
      </main>
    );
  }

  const db = tenantDb(session.gymId);
  const member = await db.member.findUnique({ where: { id: session.memberId }, include: { gym: true } });
  if (!member || member.gymId !== session.gymId || member.anonymizedAt) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">Account not found.</p>
      </main>
    );
  }

  const now = new Date();
  const tz = member.gym.timezone;
  const [upcoming, mine] = await Promise.all([
    db.classSession.findMany({
      where: { gymId: member.gymId, status: "SCHEDULED", startsAt: { gt: now }, class: { isActive: true } },
      orderBy: { startsAt: "asc" },
      take: 60,
      include: {
        class: true,
        _count: { select: { registrations: { where: { status: { in: [...SEAT_HOLDING_STATUSES] } } } } },
        registrations: { where: { memberId: member.id }, include: { payment: { select: { status: true, invoiceUrl: true } } } },
      },
    }),
    db.classRegistration.findMany({
      where: { memberId: member.id, gymId: member.gymId },
      orderBy: { session: { startsAt: "desc" } },
      take: 30,
      include: { session: { include: { class: true } }, payment: { select: { status: true, amount: true } } },
    }),
  ]);

  const online = memberPaymentsAvailable(member.gym.settings);
  const blocked = member.gym.subscriptionStatus === "SUSPENDED" || member.gym.subscriptionStatus === "CANCELLED" || member.status === "CANCELLED";

  // Group upcoming sessions by calendar day, in the gym's timezone.
  const dayOf = (d: Date) => d.toLocaleDateString("id-ID", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
  const timeOf = (d: Date) => d.toLocaleTimeString("id-ID", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const days = new Map<string, typeof upcoming>();
  for (const s of upcoming) {
    const key = dayOf(s.startsAt);
    days.set(key, [...(days.get(key) ?? []), s]);
  }

  const active = mine.filter((r) => r.status !== "CANCELLED" && r.session.status === "SCHEDULED" && r.session.startsAt > now);
  const past = mine.filter((r) => !active.includes(r));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Classes</h1>
            <p className="text-sm text-neutral-400">{member.gym.name}</p>
          </div>
          <a href="/my" className="text-sm text-neutral-300 hover:text-white">← Dashboard</a>
        </div>

        {active.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-medium text-neutral-400">Your bookings</h2>
            <ul className="space-y-2">
              {active.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm">
                  <span>
                    <span className="font-medium">{r.session.class.name}</span>
                    <span className="ml-2 text-neutral-400">{whenLabel(r.session.startsAt, tz)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    {r.status === "CONFIRMED" ? (
                      <span className="text-emerald-400">Confirmed</span>
                    ) : (
                      <span className="text-amber-400">{r.payment?.status === "PENDING" ? "Waiting for your payment" : "Pending — pay at the gym"}</span>
                    )}
                    <CancelBookingButton registrationId={r.id} paid={r.payment?.status === "PAID"} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-medium text-neutral-400">Upcoming sessions</h2>
          {blocked ? (
            <p className="text-neutral-300">Bookings are paused for this membership. Please speak to the gym.</p>
          ) : upcoming.length === 0 ? (
            <p className="rounded-xl border border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">No classes scheduled yet. Check back soon.</p>
          ) : (
            <div className="space-y-6">
              {Array.from(days.entries()).map(([day, sessions]) => (
                <div key={day}>
                  <h3 className="mb-2 text-sm text-neutral-300">{day}</h3>
                  <ul className="space-y-2">
                    {sessions.map((s) => {
                      const cap = effectiveCapacity(s, s.class);
                      const taken = s._count.registrations;
                      const full = cap !== null && taken >= cap;
                      const own = s.registrations[0];
                      const price = Number(s.class.price);
                      return (
                        <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
                          <div>
                            <p className="font-medium">
                              {timeOf(s.startsAt)} · {s.class.name}
                            </p>
                            <p className="text-sm text-neutral-400">
                              {s.class.durationMinutes} min{s.class.instructor ? ` · ${s.class.instructor}` : ""} · {price === 0 ? "free" : rp(price)}
                              {cap !== null && <span className={full ? " text-amber-400" : ""}>{` · ${Math.max(cap - taken, 0)} of ${cap} seats left`}</span>}
                            </p>
                          </div>
                          {own && own.status !== "CANCELLED" ? (
                            <span className={`text-sm ${own.status === "CONFIRMED" ? "text-emerald-400" : "text-amber-400"}`}>
                              {own.status === "CONFIRMED" ? "Booked" : "Pending"}
                            </span>
                          ) : full ? (
                            <span className="text-sm text-neutral-500">Full</span>
                          ) : (
                            <BookButton sessionId={s.id} label={price === 0 ? "Book (free)" : online ? `Book · ${rp(price)}` : "Book, pay at gym"} />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {!blocked && upcoming.length > 0 && (
            <p className="mt-6 text-xs text-neutral-500">
              {online
                ? "Paid classes take you to a secure payment page; your seat is held while you pay."
                : "Your seat is held once you book. Pay at the front desk before the class to confirm it."}
            </p>
          )}
        </section>

        {past.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-sm font-medium text-neutral-400">Past and cancelled</h2>
            <ul className="space-y-1 text-sm">
              {past.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 py-2 text-neutral-400 last:border-0">
                  <span>
                    {r.session.class.name} <span className="text-neutral-500">{whenLabel(r.session.startsAt, tz)}</span>
                  </span>
                  <span className="text-neutral-500">
                    {r.session.status === "CANCELLED" ? "Class cancelled" : r.status === "CANCELLED" ? "You cancelled" : r.status === "CONFIRMED" ? "Attended" : "Not paid"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
