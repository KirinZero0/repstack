import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { dayKeyInTimezone } from "@/lib/date";
import { getOccupancy, occupancyWindowHours } from "@/lib/occupancy";
import { getLeaderboard } from "@/lib/leaderboard";
import GymNav from "@/components/GymNav";
import OccupancyList from "./OccupancyList";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const soonCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [activeMembers, todaysCheckins, monthPayments, expiringSoon, present, board] = await Promise.all([
    db.member.count({ where: { gymId: gym.id, status: "ACTIVE" } }),
    db.checkIn.findMany({
      where: { gymId: gym.id, checkedInAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      orderBy: { checkedInAt: "desc" },
    }),
    db.payment.findMany({
      where: { gymId: gym.id, status: "PAID", paidAt: { gte: monthStart } },
    }),
    db.member.findMany({
      where: {
        gymId: gym.id,
        status: "ACTIVE",
        membershipExpiry: { gte: now, lte: soonCutoff },
      },
      orderBy: { membershipExpiry: "asc" },
      take: 20,
    }),
    getOccupancy(db, gym.id, gym.settings, now),
    getLeaderboard(db, gym.id, gym.timezone, now),
  ]);

  const todayKey = dayKeyInTimezone(now, gym.timezone);
  const checkinsToday = todaysCheckins.filter(
    (c) => dayKeyInTimezone(c.checkedInAt, gym.timezone) === todayKey && c.result === "SUCCESS",
  );

  const monthRevenue = monthPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const timeOf = (d: Date) => d.toLocaleTimeString("id-ID", { timeZone: gym.timezone, hour: "2-digit", minute: "2-digit" });

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="gym-head mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{gym.name}</h1>
            <p className="text-sm text-neutral-400">Dashboard</p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="dashboard" />
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="In the gym now" value={present.length.toString()} />
          <StatCard label="Check-ins today" value={checkinsToday.length.toString()} />
          <StatCard label="Active members" value={activeMembers.toString()} />
          <StatCard
            label="Revenue this month"
            value={`Rp ${monthRevenue.toLocaleString("id-ID")}`}
          />
        </div>

        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <OccupancyList
            slug={params.slug}
            windowHours={occupancyWindowHours(gym.settings)}
            rows={present.map((p) => ({ checkInId: p.checkInId, fullName: p.fullName, sinceLabel: timeOf(p.since) }))}
          />

          <div className="rounded-xl border border-neutral-800">
            <div className="border-b border-neutral-800 px-4 py-3">
              <h2 className="font-medium">Most visits this month</h2>
            </div>
            {board.visits.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-neutral-500">No check-ins yet this month.</p>
            ) : (
              <ol className="divide-y divide-neutral-800 text-sm">
                {board.visits.slice(0, 8).map((r, i) => (
                  <li key={r.memberId} className="flex items-center justify-between px-4 py-2.5">
                    <span>
                      <span className="mr-3 inline-block w-5 text-right tabular-nums text-neutral-500">{i + 1}</span>
                      {r.fullName}
                    </span>
                    <span className="tabular-nums text-neutral-300">{`${r.value} visit${r.value === 1 ? "" : "s"}`}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800">
          <div className="border-b border-neutral-800 px-4 py-3">
            <h2 className="font-medium">Expiring within 7 days</h2>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {expiringSoon.map((m) => (
                <tr key={m.id} className="border-t border-neutral-800">
                  <td className="px-4 py-3">{m.fullName}</td>
                  <td className="px-4 py-3 text-neutral-400">
                    {m.membershipExpiry?.toLocaleDateString("id-ID")}
                  </td>
                </tr>
              ))}
              {expiringSoon.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-neutral-500">
                    No memberships expiring soon.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card rounded-xl border border-neutral-800 bg-neutral-900 p-5 pl-6">
      <p className="text-sm text-neutral-400">{label}</p>
      <p className="stat-value mt-1 text-3xl font-semibold">{value}</p>
    </div>
  );
}
