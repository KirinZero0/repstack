import { redirect } from "next/navigation";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { getPlatformFinance } from "@/lib/stats";
import { BarChart, Card, HBars, StatCard, StatusPill, rp } from "@/components/charts";
import LogoutButton from "../gyms/LogoutButton";

export const dynamic = "force-dynamic";

export default async function SuperadminDashboardPage() {
  try {
    await requireSuperadminSession();
  } catch (err) {
    if (err instanceof SessionError) redirect("/superadmin/login");
    throw err;
  }

  const f = await getPlatformFinance();
  const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Platform dashboard</h1>
            <p className="text-sm text-neutral-400">Revenue and tenants across Liftmora</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/superadmin/gyms" className="text-neutral-300 hover:text-white">Gyms</a>
            <a href="/superadmin/invoices" className="text-neutral-300 hover:text-white">Invoices</a>
            <a href="/superadmin/settings" className="text-neutral-300 hover:text-white">Settings</a>
            <LogoutButton />
          </nav>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="MRR" value={rp(f.mrr)} sub="recurring, excl. lifetime" />
          <StatCard label="ARR (projected)" value={rp(f.arr)} />
          <StatCard label="Collected this month" value={rp(f.collectedThisMonth)} sub={`${rp(f.collectedYear)} last 12 mo`} />
          <StatCard
            label="Outstanding invoices"
            value={rp(f.pendingAmount)}
            sub={`${f.pendingCount} pending`}
            tone={f.pendingCount > 0 ? "bad" : undefined}
          />
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Gym tenants" value={String(f.totalGyms)} />
          <StatCard label="Active members (all gyms)" value={String(f.activeMembers)} />
          <StatCard label="Lifetime deals (one-time)" value={rp(f.lifetimeRevenue)} sub="not part of MRR" />
          <StatCard label="Setup fees (one-time)" value={rp(f.setupFeesCollected)} sub={`${f.setupFeesCount} paid · not part of MRR`} />
        </div>

        <div className="mb-6">
          <Card title="Subscription revenue collected — last 12 months">
            <BarChart data={f.monthly} format={short} />
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Tenants by status">
            <div className="space-y-2">
              {f.statusCounts.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <StatusPill status={s.status} />
                  <span className="text-neutral-300">{s.count}</span>
                </div>
              ))}
              {f.statusCounts.length === 0 && <p className="text-sm text-neutral-500">No gyms yet.</p>}
            </div>
          </Card>
          <Card title="Biggest gyms by members">
            <HBars data={f.gymsByMembers} />
          </Card>
        </div>
      </div>
    </main>
  );
}
