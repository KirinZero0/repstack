import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { dayKeyInTimezone } from "@/lib/date";
import LogoutButton from "./LogoutButton";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: { slug: string } }) {
  let session, gym;
  try {
    ({ session, gym } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/g/${params.slug}/login`);
    throw err;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const soonCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [activeMembers, todaysCheckins, monthPayments, expiringSoon] = await Promise.all([
    prisma.member.count({ where: { gymId: gym.id, status: "ACTIVE" } }),
    prisma.checkIn.findMany({
      where: { gymId: gym.id, checkedInAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      orderBy: { checkedInAt: "desc" },
    }),
    prisma.payment.findMany({
      where: { gymId: gym.id, status: "PAID", paidAt: { gte: monthStart } },
    }),
    prisma.member.findMany({
      where: {
        gymId: gym.id,
        status: "ACTIVE",
        membershipExpiry: { gte: now, lte: soonCutoff },
      },
      orderBy: { membershipExpiry: "asc" },
      take: 20,
    }),
  ]);

  const todayKey = dayKeyInTimezone(now, gym.timezone);
  const checkinsToday = todaysCheckins.filter(
    (c) => dayKeyInTimezone(c.checkedInAt, gym.timezone) === todayKey && c.result === "SUCCESS",
  );

  const monthRevenue = monthPayments.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{gym.name}</h1>
            <p className="text-sm text-neutral-400">Dashboard</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href={`/g/${params.slug}/members`} className="text-neutral-300 hover:text-white">
              Members
            </a>
            <a href={`/g/${params.slug}/checkin-station`} className="text-neutral-300 hover:text-white">
              Check-in poster
            </a>
            <a href={`/g/${params.slug}/checkin`} className="text-neutral-300 hover:text-white">
              Staff scanner
            </a>
            {session.role === "OWNER" && (
              <>
                <a href={`/g/${params.slug}/plans`} className="text-neutral-300 hover:text-white">
                  Plans
                </a>
                <a href={`/g/${params.slug}/finance`} className="text-neutral-300 hover:text-white">
                  Finance
                </a>
                <a href={`/g/${params.slug}/billing`} className="text-neutral-300 hover:text-white">
                  Billing
                </a>
                <a href={`/g/${params.slug}/settings`} className="text-neutral-300 hover:text-white">
                  Settings
                </a>
              </>
            )}
            <LogoutButton slug={params.slug} />
          </nav>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Active members" value={activeMembers.toString()} />
          <StatCard label="Check-ins today" value={checkinsToday.length.toString()} />
          <StatCard
            label="Revenue this month"
            value={`Rp ${monthRevenue.toLocaleString("id-ID")}`}
          />
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
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <p className="text-sm text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
