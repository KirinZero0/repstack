import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { getGymFinance } from "@/lib/stats";
import { BarChart, Card, HBars, StatCard, StatusPill, rp } from "@/components/charts";
import GymNav from "@/components/GymNav";

export const dynamic = "force-dynamic";

export default async function FinancePage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  if (session.role !== "OWNER") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">403 — Only the gym owner can view financials.</p>
      </main>
    );
  }

  const f = await getGymFinance(db, gym.id, gym.timezone);
  const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const change =
    f.changePct === null ? "no prior month" : `${f.changePct >= 0 ? "+" : ""}${f.changePct.toFixed(0)}% vs last month`;

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Financials</h1>
            <p className="text-sm text-neutral-400">{gym.name}</p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="finance" />
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Revenue this month"
            value={rp(f.thisMonth)}
            sub={change}
            tone={f.changePct === null ? undefined : f.changePct >= 0 ? "good" : "bad"}
          />
          <StatCard label="Last month" value={rp(f.lastMonth)} />
          <StatCard label="Last 12 months" value={rp(f.yearTotal)} />
          <StatCard
            label="Awaiting payment"
            value={rp(f.pendingAmount)}
            sub={`${f.pendingCount} unpaid invoice${f.pendingCount === 1 ? "" : "s"}`}
            tone={f.pendingCount > 0 ? "bad" : undefined}
          />
        </div>

        <div className="mb-6">
          <Card title="Membership revenue — last 12 months">
            <BarChart data={f.monthly} format={short} />
          </Card>
        </div>

        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card title="This month by plan">
            <HBars data={f.byPlan} format={rp} />
          </Card>
          <Card title="This month by how they paid">
            <HBars data={f.byMethod} format={rp} />
          </Card>
          <Card title="Payments by status (all time)">
            <div className="space-y-2">
              {f.statusCounts.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <StatusPill status={s.status} />
                  <span className="text-neutral-300">{s.count}</span>
                </div>
              ))}
              {f.statusCounts.length === 0 && <p className="text-sm text-neutral-500">No payments yet.</p>}
            </div>
          </Card>
        </div>

        <Card title="Recent payments">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="pb-2 font-normal">Date</th>
                <th className="pb-2 font-normal">Member</th>
                <th className="pb-2 font-normal">Plan</th>
                <th className="pb-2 font-normal">Amount</th>
                <th className="pb-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {f.recent.map((p) => (
                <tr key={p.id} className="border-t border-neutral-800">
                  <td className="py-2 text-neutral-400">{p.date.toLocaleDateString("id-ID")}</td>
                  <td className="py-2">{p.member}</td>
                  <td className="py-2 text-neutral-400">{p.plan}</td>
                  <td className="py-2">{rp(p.amount)}</td>
                  <td className="py-2"><StatusPill status={p.status} /></td>
                </tr>
              ))}
              {f.recent.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-neutral-500">No payments yet.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </main>
  );
}
