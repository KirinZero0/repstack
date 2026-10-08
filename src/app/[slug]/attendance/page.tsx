import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { dayKeyInTimezone } from "@/lib/date";
import GymNav from "@/components/GymNav";
import AttendanceDesk, { type EntryRow, type MemberOption, type PlanOption } from "./AttendanceDesk";

export const dynamic = "force-dynamic";

/** Front desk: log a walk-in day pass bought on the spot, check a member in by hand, and see who came in today. */
export default async function AttendancePage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const todayKey = dayKeyInTimezone(new Date(), gym.timezone);
  const [plans, members, checkins, guests] = await Promise.all([
    db.dayPassPlan.findMany({ where: { gymId: gym.id, isActive: true }, orderBy: { createdAt: "asc" } }),
    db.member.findMany({
      where: { gymId: gym.id, status: { in: ["ACTIVE", "EXPIRED", "PENDING_PAYMENT", "FROZEN"] } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, status: true },
      take: 2000,
    }),
    db.checkIn.findMany({
      where: { gymId: gym.id, result: "SUCCESS", checkedInAt: { gte: since } },
      orderBy: { checkedInAt: "desc" },
      include: { member: { select: { fullName: true } } },
    }),
    db.guestPass.findMany({
      where: { gymId: gym.id, status: "ATTENDED", attendedAt: { gte: since } },
      orderBy: { attendedAt: "desc" },
      include: { dayPassPlan: { select: { name: true } }, session: { select: { class: { select: { name: true } } } } },
    }),
  ]);

  const time = (d: Date) => d.toLocaleTimeString("id-ID", { timeZone: gym.timezone, hour: "2-digit", minute: "2-digit" });
  const entries: (EntryRow & { at: number })[] = [
    ...checkins
      .filter((c) => dayKeyInTimezone(c.checkedInAt, gym.timezone) === todayKey)
      .map((c) => ({ id: c.id, at: c.checkedInAt.getTime(), name: c.member.fullName, kind: "Member", time: time(c.checkedInAt) })),
    ...guests
      .filter((g) => g.attendedAt && dayKeyInTimezone(g.attendedAt, gym.timezone) === todayKey)
      .map((g) => ({
        id: g.id,
        at: g.attendedAt!.getTime(),
        name: g.fullName,
        kind: g.session ? `Class guest (${g.session.class.name})` : `Day pass${g.dayPassPlan ? ` (${g.dayPassPlan.name})` : ""}`,
        time: time(g.attendedAt!),
      })),
  ].sort((a, b) => b.at - a.at);

  const planOptions: PlanOption[] = plans.map((p) => ({ id: p.id, name: p.name, price: Number(p.price) }));
  const memberOptions: MemberOption[] = members.map((m) => ({ id: m.id, fullName: m.fullName, status: m.status }));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="gym-head mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Attendance</h1>
            <p className="text-sm text-neutral-400">{gym.name} · log visits by hand when there&apos;s no QR to scan.</p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="attendance" />
        </div>
        <AttendanceDesk slug={params.slug} plans={planOptions} members={memberOptions} entries={entries} />
      </div>
    </main>
  );
}
