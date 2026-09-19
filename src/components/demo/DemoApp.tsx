"use client";

import { useCallback, useMemo, useState } from "react";
import BrandMark from "../BrandMark";
import { BarChart, Card, HBars, StatCard, StatusPill, rp } from "../charts";
import Tour, { type TourStep } from "./Tour";
import {
  INITIAL_MEMBERS,
  INITIAL_PLANS,
  RECENT_PAYMENTS,
  REVENUE_BY_PLAN,
  REVENUE_MONTHS,
  type DemoMember,
  type DemoPlan,
} from "./data";

type Tab = "dashboard" | "members" | "plans" | "finance" | "poster";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "members", label: "Members" },
  { id: "plans", label: "Plans" },
  { id: "finance", label: "Finance" },
  { id: "poster", label: "Check-in poster" },
];

const STEPS: TourStep[] = [
  {
    title: "Welcome to your gym",
    body: "You're the owner of Demo Gym. This 2-minute tour shows how you'd run memberships, check-ins and billing. Everything here is sample data, and nothing is saved.",
    tab: "dashboard",
  },
  {
    title: "Your day at a glance",
    body: "Active members, how many people checked in today, and what you've collected this month. This is the first screen you see after logging in.",
    target: "stats",
    tab: "dashboard",
  },
  {
    title: "See who's about to lapse",
    body: "Members whose plan ends within 7 days show up here. They also get an automatic WhatsApp reminder three days before, so you don't have to chase anyone.",
    target: "expiring",
    tab: "dashboard",
  },
  {
    title: "Now let's add a member",
    body: "Everything about your people lives under Members.",
    target: "nav-members",
    action: "Click Members",
    advanceOnClick: true,
    tab: "dashboard",
  },
  {
    title: "Your member list",
    body: "Phone numbers and emails are masked here, and encrypted in the database. Statuses update themselves: paying activates a member, and passing the end date marks them expired.",
    target: "member-table",
    tab: "members",
  },
  {
    title: "Add a member in seconds",
    body: "Enter a name, phone and plan. We'll fill the form in for you.",
    target: "add-member",
    action: "Click + Add member",
    advanceOnClick: true,
    tab: "members",
  },
  {
    title: "Just three fields",
    body: "Name, WhatsApp number and the plan they picked. Nothing else is needed to get them started.",
    target: "add-form",
    action: "Click Add member in the form",
    advanceOnSubmit: true,
    tab: "members",
  },
  {
    title: "They get everything on WhatsApp",
    body: "Saving sends the new member an activation link plus a payment invoice. Once they pay, their membership switches on. You never handle cash or chase transfers.",
    target: "whatsapp",
    tab: "members",
  },
  {
    title: "Set your own prices",
    body: "Every gym builds its own plans: a name, a length in days and a price. Members only see the plans you have on sale.",
    target: "nav-plans",
    action: "Click Plans",
    advanceOnClick: true,
    tab: "members",
  },
  {
    title: "Hide plans instead of deleting them",
    body: "Retire a plan with Hide and it stops being offered, while members who already have it keep their access. Try hiding one.",
    target: "plan-table",
    tab: "plans",
  },
  {
    title: "No webcam, no front desk",
    body: "Print this poster once and mount it at the entrance. Members scan it with their own phone to check in. Expired or frozen members get a red screen, and everyone is limited to one visit a day.",
    target: "poster",
    tab: "poster",
  },
  {
    title: "Know where the money is",
    body: "Revenue by month and by plan, plus invoices that are still unpaid. It's all in one place, no spreadsheet needed.",
    target: "finance",
    tab: "finance",
  },
  {
    title: "That's the owner side",
    body: "Members get their own app with a big Check in button, attendance streaks and a Renew button that pays through Xendit. Ready to run your own gym on Iron Ledger?",
    tab: "dashboard",
    final: true,
  },
];

/** Deterministic pseudo-QR so the poster looks real without any library. */
function FakeQr() {
  const n = 25;
  const cells: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));
  let seed = 42;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) cells[y][x] = rand() > 0.5;
  const finder = (ox: number, oy: number) => {
    for (let y = -1; y <= 7; y++)
      for (let x = -1; x <= 7; x++) {
        const yy = oy + y;
        const xx = ox + x;
        if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
        const ring = x === 0 || x === 6 || y === 0 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        cells[yy][xx] = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (ring || core);
      }
  };
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className="h-56 w-56" shapeRendering="crispEdges" role="img" aria-label="Sample check-in QR code">
      <rect width={n} height={n} fill="#ffffff" />
      {cells.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0f151b" /> : null)))}
    </svg>
  );
}

const field =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-plate-blue";

export default function DemoApp({ contactUrl }: { contactUrl: string }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [tourOn, setTourOn] = useState(true);
  const [tourKey, setTourKey] = useState(0);
  const [members, setMembers] = useState<DemoMember[]>(INITIAL_MEMBERS);
  const [plans, setPlans] = useState<DemoPlan[]>(INITIAL_PLANS);
  const [showForm, setShowForm] = useState(false);
  const [sent, setSent] = useState<DemoMember | null>(null);
  const [form, setForm] = useState({ name: "Nadia Rahma", phone: "0812 5550 0142", plan: "Monthly" });

  const onTab = useCallback((t: string) => {
    setTab(t as Tab);
  }, []);

  const steps = useMemo<TourStep[]>(() => STEPS, []);

  const expiring = members.filter((m) => m.status === "ACTIVE" && m.expiresInDays !== null && m.expiresInDays <= 7 && m.expiresInDays >= 0);
  const active = members.filter((m) => m.status === "ACTIVE").length;

  function addMember(e: React.FormEvent) {
    e.preventDefault();
    const m: DemoMember = {
      name: form.name || "New member",
      email: "n•••@mail.com",
      phone: `+62•••••${form.phone.replace(/\D/g, "").slice(-4) || "0000"}`,
      plan: form.plan,
      status: "PENDING_PAYMENT",
      expiresInDays: null,
    };
    setMembers((ms) => [m, ...ms]);
    setSent(m);
    setShowForm(false);
  }

  function restart() {
    setTab("dashboard");
    setMembers(INITIAL_MEMBERS);
    setPlans(INITIAL_PLANS);
    setShowForm(false);
    setSent(null);
    setTourKey((k) => k + 1);
    setTourOn(true);
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="border-b border-plate-yellow/40 bg-plate-yellow/10 px-4 py-2 text-center text-sm text-neutral-200">
        Demo with sample data. Nothing you do here is saved.
        {!tourOn && (
          <button onClick={restart} className="ml-3 font-semibold underline underline-offset-2">
            Restart the tour
          </button>
        )}
      </div>

      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-4">
            <BrandMark href="/" />
            <span className="hidden rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-400 sm:inline">Demo Gym · Owner</span>
          </div>
          <nav className="flex flex-wrap gap-1 text-sm" aria-label="Demo sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                data-tour={`nav-${t.id}`}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  tab === t.id ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {tab === "dashboard" && (
          <div>
            <h1 className="mb-6 text-2xl font-semibold">Demo Gym</h1>
            <div data-tour="stats" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label="Active members" value={String(active)} />
              <StatCard label="Check-ins today" value="14" />
              <StatCard label="Revenue this month" value={rp(6250000)} sub="+4% vs last month" tone="good" />
            </div>
            <div data-tour="expiring" className="rounded-xl border border-neutral-800">
              <div className="border-b border-neutral-800 px-4 py-3 font-medium">Expiring within 7 days</div>
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-4 py-3 font-normal">Name</th>
                    <th className="px-4 py-3 font-normal">Days left</th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.map((m) => (
                    <tr key={m.name} className="border-t border-neutral-800">
                      <td className="px-4 py-3">{m.name}</td>
                      <td className="px-4 py-3 text-amber-400">{m.expiresInDays}</td>
                    </tr>
                  ))}
                  {expiring.length === 0 && (
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
        )}

        {tab === "members" && (
          <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Members</h1>
              <button
                data-tour="add-member"
                onClick={() => {
                  setSent(null);
                  setShowForm((s) => !s);
                }}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200"
              >
                + Add member
              </button>
            </div>

            {showForm && (
              <form data-tour="add-form" onSubmit={addMember} className="mb-6 grid gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Full name</span>
                  <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">WhatsApp number</span>
                  <input className={field} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Plan</span>
                  <select className={field} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                    {plans.filter((p) => p.onSale).map((p) => (
                      <option key={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="self-end rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                  Add member
                </button>
              </form>
            )}

            {sent && (
              <div data-tour="whatsapp" className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <p className="mb-3 text-sm text-neutral-300">
                  {sent.name} was added. This WhatsApp message is on its way to them:
                </p>
                <div className="max-w-sm rounded-2xl rounded-tl-sm bg-[#d9fdd3] p-3 text-sm leading-relaxed text-[#111b21] shadow">
                  Hi {sent.name.split(" ")[0]}! You&apos;ve been added to Demo Gym.
                  <br />
                  Activate your account and set a password: <span className="text-[#027eb5] underline">activate/8f3k2q…</span>
                  <br />
                  Complete your membership payment: <span className="text-[#027eb5] underline">pay.xendit.co/…</span>
                </div>
              </div>
            )}

            <div data-tour="member-table" className="overflow-x-auto rounded-xl border border-neutral-800">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-4 py-3 font-normal">Name</th>
                    <th className="px-4 py-3 font-normal">Email</th>
                    <th className="px-4 py-3 font-normal">Phone</th>
                    <th className="px-4 py-3 font-normal">Plan</th>
                    <th className="px-4 py-3 font-normal">Status</th>
                    <th className="px-4 py-3 font-normal">Days left</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.name} className="border-t border-neutral-800">
                      <td className="px-4 py-3 font-medium">{m.name}</td>
                      <td className="px-4 py-3 text-neutral-400">{m.email}</td>
                      <td className="px-4 py-3 text-neutral-400">{m.phone}</td>
                      <td className="px-4 py-3">{m.plan}</td>
                      <td className="px-4 py-3">
                        <StatusPill status={m.status} />
                      </td>
                      <td className="px-4 py-3 text-neutral-400">{m.expiresInDays === null ? "—" : m.expiresInDays < 0 ? "expired" : m.expiresInDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "plans" && (
          <div>
            <h1 className="mb-6 text-2xl font-semibold">Membership plans</h1>
            <div data-tour="plan-table" className="overflow-hidden rounded-xl border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-4 py-3 font-normal">Plan</th>
                    <th className="px-4 py-3 font-normal">Length</th>
                    <th className="px-4 py-3 font-normal">Price</th>
                    <th className="px-4 py-3 font-normal">Members</th>
                    <th className="px-4 py-3 font-normal">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className="border-t border-neutral-800">
                      <td className="px-4 py-3 font-medium">{p.name}</td>
                      <td className="px-4 py-3 text-neutral-400">{p.days} days</td>
                      <td className="px-4 py-3">{rp(p.price)}</td>
                      <td className="px-4 py-3 text-neutral-400">{p.members}</td>
                      <td className="px-4 py-3">
                        <span className={p.onSale ? "text-emerald-400" : "text-neutral-500"}>{p.onSale ? "On sale" : "Hidden"}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setPlans((ps) => ps.map((x) => (x.id === p.id ? { ...x, onSale: !x.onSale } : x)))}
                          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
                        >
                          {p.onSale ? "Hide" : "Put on sale"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-neutral-500">Hidden plans stay on existing members but can&apos;t be chosen for new members or renewals.</p>
          </div>
        )}

        {tab === "poster" && (
          <div className="flex flex-col items-center text-center">
            <h1 className="mb-6 text-2xl font-semibold">Demo Gym: Check-in</h1>
            <div data-tour="poster" className="rounded-2xl bg-[#ffffff] p-6">
              <FakeQr />
            </div>
            <p className="mt-6 max-w-sm text-sm text-neutral-400">Members: open your Iron Ledger app and scan this code to check yourself in.</p>
          </div>
        )}

        {tab === "finance" && (
          <div data-tour="finance">
            <h1 className="mb-6 text-2xl font-semibold">Financials</h1>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Revenue this month" value={rp(6250000)} sub="+4% vs last month" tone="good" />
              <StatCard label="Last month" value={rp(6000000)} />
              <StatCard label="Last 12 months" value={rp(24850000)} />
              <StatCard label="Awaiting payment" value={rp(250000)} sub="1 unpaid invoice" tone="bad" />
            </div>
            <div className="mb-6">
              <Card title="Membership revenue">
                <BarChart data={REVENUE_MONTHS} format={(n) => `${(n / 1_000_000).toFixed(1)}M`} />
              </Card>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="This month by plan">
                <HBars data={REVENUE_BY_PLAN} format={rp} />
              </Card>
              <Card title="Recent payments">
                <ul className="space-y-2 text-sm">
                  {RECENT_PAYMENTS.map((p) => (
                    <li key={p.member + p.date} className="flex items-center justify-between border-b border-neutral-800 pb-2 last:border-0">
                      <span>
                        {p.member} <span className="text-neutral-500">· {p.plan}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {rp(p.amount)} <StatusPill status={p.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        )}
      </main>

      {tourOn && (
        <Tour
          key={tourKey}
          steps={steps}
          onTab={onTab}
          onClose={() => setTourOn(false)}
          renderFinal={() => (
            <div className="flex flex-wrap gap-2">
              <a href={contactUrl} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                Set up my gym
              </a>
              <a href="/#pricing" className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold hover:bg-neutral-800">
                See pricing
              </a>
              <button onClick={() => setTourOn(false)} className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-white">
                Keep exploring
              </button>
            </div>
          )}
        />
      )}
    </div>
  );
}
