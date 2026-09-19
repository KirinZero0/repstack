import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMemberAttendance } from "@/lib/stats";
import { BarChart, Card, Heatmap, StatCard, StatusPill, rp } from "@/components/charts";
import MemberLogout from "./MemberLogout";

export const dynamic = "force-dynamic";

export default async function MemberDashboardPage() {
  const session = await getSession();

  if (!session || session.kind !== "member") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <div className="text-center">
          <p className="mb-4 text-neutral-300">Log in as a member to see your dashboard.</p>
          <a href="/" className="text-sm text-neutral-500 hover:text-neutral-300">← Back home</a>
        </div>
      </main>
    );
  }

  const member = await prisma.member.findUnique({
    where: { id: session.memberId },
    include: { plan: true, gym: true },
  });
  if (!member || member.gymId !== session.gymId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">Account not found.</p>
      </main>
    );
  }

  const [att, payments] = await Promise.all([
    getMemberAttendance(member.id, member.gym.timezone),
    prisma.payment.findMany({
      where: { memberId: member.id, gymId: member.gymId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { plan: { select: { name: true } } },
    }),
  ]);

  const daysLeft = member.membershipExpiry
    ? Math.ceil((member.membershipExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Hi, {member.fullName.split(" ")[0]}</h1>
            <p className="text-sm text-neutral-400">{member.gym.name}</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/my-qr" className="text-neutral-300 hover:text-white">My QR</a>
            <MemberLogout slug={member.gym.slug} />
          </nav>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div>
            <p className="text-sm text-neutral-400">{member.plan.name} membership</p>
            <div className="mt-1 flex items-center gap-3">
              <StatusPill status={member.status} />
              <span className={`text-sm ${expiringSoon ? "text-amber-400" : "text-neutral-300"}`}>
                {member.membershipExpiry
                  ? daysLeft !== null && daysLeft >= 0
                    ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left · expires ${member.membershipExpiry.toLocaleDateString("id-ID")}`
                    : `expired ${member.membershipExpiry.toLocaleDateString("id-ID")}`
                  : "no active period"}
              </span>
            </div>
          </div>
          <a
            href="/check-in"
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200"
          >
            Check in now →
          </a>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Visits this month" value={String(att.thisMonth)} />
          <StatCard label="Current streak" value={`${att.streak} day${att.streak === 1 ? "" : "s"}`} />
          <StatCard label="Total visits" value={String(att.total)} />
          <StatCard label="Last visit" value={att.last ? att.last.toLocaleDateString("id-ID") : "—"} />
        </div>

        <div className="mb-6 grid gap-6 sm:grid-cols-2">
          <Card title="Last 12 weeks">
            <Heatmap data={att.heat} />
            <p className="mt-3 text-xs text-neutral-500">Each square is a day; green = you visited.</p>
          </Card>
          <Card title="Visits per week">
            <BarChart data={att.weekly} />
          </Card>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Card title="Recent visits">
            {att.recent.length === 0 ? (
              <p className="text-sm text-neutral-500">No visits yet — go lift something.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {att.recent.map((d, i) => (
                  <li key={i} className="flex justify-between border-b border-neutral-800 pb-2 last:border-0">
                    <span>{d.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" })}</span>
                    <span className="text-neutral-500">
                      {d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: member.gym.timezone })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Payments">
            {payments.length === 0 ? (
              <p className="text-sm text-neutral-500">No payments yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between border-b border-neutral-800 pb-2 last:border-0">
                    <span>
                      {p.plan.name}
                      <span className="ml-2 text-neutral-500">{p.createdAt.toLocaleDateString("id-ID")}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {rp(Number(p.amount))} <StatusPill status={p.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}
