"use client";

import { useCallback, useMemo, useState } from "react";
import BrandMark from "../BrandMark";
import { BarChart, Card, HBars, StatCard, StatusPill, rp } from "../charts";
import Tour, { type TourStep } from "./Tour";
import {
  CHECKED_IN_TODAY,
  CLASSES,
  DAY_PASSES,
  FIELDS,
  GUEST_REQUESTS,
  IN_GYM_NOW,
  INITIAL_MEMBERS,
  INITIAL_PLANS,
  INITIAL_REQUESTS,
  MOST_VISITS,
  RECENT_PAYMENTS,
  REFUNDS,
  REVENUE_BY_PLAN,
  REVENUE_MONTHS,
  ROSTER,
  STAFF,
  type DemoGuest,
  type DemoMember,
  type DemoPlan,
  type DemoRequest,
} from "./data";

// "requests" and "guests" are sub-pages of Members (reached from its links), so they have no tab in the nav.
type Tab =
  | "dashboard"
  | "members"
  | "requests"
  | "guests"
  | "classes"
  | "fields"
  | "poster"
  | "scanner"
  | "attendance"
  | "staff"
  | "plans"
  | "finance"
  | "member";

// Same order as the real gym nav (Billing and Settings are left out of the demo).
const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "members", label: "Members" },
  { id: "classes", label: "Classes" },
  { id: "fields", label: "Fields" },
  { id: "poster", label: "Check-in poster" },
  { id: "scanner", label: "Staff scanner" },
  { id: "attendance", label: "Attendance" },
  { id: "staff", label: "Staff" },
  { id: "plans", label: "Plans" },
  { id: "finance", label: "Finance" },
  { id: "member", label: "Member app" },
];

const STEPS: TourStep[] = [
  {
    title: "Welcome to your gym",
    body: "You're the owner of Demo Gym. This short tour shows how you'd run memberships, check-ins, classes, guests, court bookings and the money. Everything here is sample data, and nothing is saved.",
    tab: "dashboard",
  },
  {
    title: "Your day at a glance",
    body: "Who's in the gym now, how many checked in today, your active members and what you've collected this month. This is the first screen you see after logging in.",
    target: "stats",
    tab: "dashboard",
  },
  {
    title: "Who's here right now",
    body: "Everyone who checked in within the last 3 hours, members and day-pass visitors alike, plus today's full list and who visits most this month.",
    target: "in-gym",
    tab: "dashboard",
  },
  {
    title: "See who's about to lapse",
    body: "Members whose plan ends within 7 days show up here. They also get an automatic reminder three days before, so you don't have to chase anyone.",
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
    body: "Everyone in one table: plan, status, when they're paid until, and whether they've set up their login yet. Statuses update themselves: when the end date passes, a member is marked expired. Export or import the whole list as a spreadsheet.",
    target: "member-table",
    tab: "members",
  },
  {
    title: "Find anyone in a second",
    body: "Type a name or a phone number and the list narrows as you type. Try \"budi\". Contact details are stored encrypted, and only you and your staff can see them.",
    target: "member-search",
    tab: "members",
  },
  {
    title: "Add a member who paid you",
    body: "Someone just signed up and paid at the desk. We'll fill the form in for you.",
    target: "add-member",
    action: "Click + Add member",
    advanceOnClick: true,
    tab: "members",
  },
  {
    title: "Name, email, phone, plan",
    body: "Their email is their login. Leave Paid until blank for the plan's normal length, or set a date if they paid for something different. Adding them here means they've paid, so they're active straight away and the payment lands in your revenue.",
    target: "add-form",
    action: "Click Add member in the form",
    advanceOnSubmit: true,
    tab: "members",
  },
  {
    title: "Their welcome goes out",
    body: "They get their dates and a link to set a password and see their check-in QR, by email or WhatsApp. Until they set it, Activated shows Pending, and Resend QR link sends them a fresh one.",
    target: "whatsapp",
    tab: "members",
  },
  {
    title: "When someone renews",
    body: "Andi's membership expired last week, and he just handed over cash at the front desk. Record it from his row.",
    target: "record-pay-btn",
    action: "Click Record payment",
    advanceOnClick: true,
    tab: "members",
  },
  {
    title: "Enter what you received",
    body: "Pick the plan, the amount you received (change it for a discount) and the date. A note like \"cash at front desk\" helps later. Owners and staff can both do this.",
    target: "record-pay-form",
    action: "Click Save payment in the form",
    advanceOnSubmit: true,
    tab: "members",
  },
  {
    title: "Their membership is back on",
    body: "Andi is active again and his new dates are set. He gets a receipt, the payment shows in your revenue with your name on it, and an owner can void it if you typed something wrong.",
    target: "paid-row",
    tab: "members",
  },
  {
    title: "People can also join on their own",
    body: "Your gym has its own sign-up page. Someone picks a plan, transfers the fee to your bank account and uploads the receipt. Their request waits here, so nobody becomes a member until you've checked the money.",
    target: "pending-banner",
    action: "Click Review",
    advanceOnClick: true,
    tab: "members",
  },
  {
    title: "Check the transfer",
    body: "Each request shows the plan, the amount and the receipt they uploaded. Compare it with your bank app before you approve.",
    target: "request-card",
    tab: "requests",
  },
  {
    title: "Approve in one tap",
    body: "Approving creates the member, records the payment and starts their membership. If the money never arrived, Reject instead and nothing is created.",
    target: "approve-btn",
    action: "Click Approve",
    advanceOnClick: true,
    tab: "requests",
  },
  {
    title: "They're in",
    body: "Rizky is now an active member with the login he chose. He gets a welcome message and can open his check-in QR straight away. You didn't have to type anything.",
    target: "approved-row",
    tab: "members",
  },
  {
    title: "Visitors who aren't members",
    body: "People can also ask for a day pass or a spot in a class from your public page. Those requests live here.",
    target: "guests-link",
    action: "Click Guest passes",
    advanceOnClick: true,
    tab: "members",
  },
  {
    title: "Check, then approve",
    body: "Each request shows what they asked for, the price and their transfer proof. Nothing is issued until you've checked the money.",
    target: "guest-card",
    tab: "guests",
  },
  {
    title: "Approve, and the ticket goes out",
    body: "Kevin's transfer is in your bank. Approve his day pass.",
    target: "guest-approve",
    action: "Click Payment received, approve",
    advanceOnClick: true,
    tab: "guests",
  },
  {
    title: "A one-time QR ticket",
    body: "Kevin gets his ticket by email or WhatsApp. Staff scan it once at the door on the staff scanner, and if he loses it you can send it again.",
    target: "guest-ticket",
    tab: "guests",
  },
  {
    title: "Run classes too",
    body: "Set up a class once and schedule the weeks. Members book a spot from their phone, a full class stops taking bookings, and everyone booked gets a reminder the day before.",
    target: "class-list",
    tab: "classes",
  },
  {
    title: "Rosters and no-shows",
    body: "Each session has its roster. Tick who came, and no-shows are kept on record. Paid classes show up in your finance like any other payment.",
    target: "roster",
    tab: "classes",
  },
  {
    title: "Courts and pitches by the hour",
    body: "Rent out badminton courts or a futsal pitch? People pick a time on your booking page and you approve it. Approved bookings fill the day's timeline and can never overlap. Charge per field or per person.",
    target: "field-timeline",
    tab: "fields",
  },
  {
    title: "Phone bookings and closed time",
    body: "Someone rang to book, or a court needs repairs? Add the booking, or block the time, straight from the day's list.",
    target: "field-actions",
    tab: "fields",
  },
  {
    title: "Members check themselves in",
    body: "Print this poster once and mount it at the entrance. Members scan it with their own phone. Expired or frozen members are turned away, and everyone is limited to one visit a day.",
    target: "poster",
    tab: "poster",
  },
  {
    title: "Or scan their QR at the desk",
    body: "The staff scanner uses any phone or tablet camera. It reads members' QR codes and guests' tickets. Let's scan Sari.",
    target: "scan-btn",
    action: "Click Scan Sari's QR",
    advanceOnClick: true,
    tab: "scanner",
  },
  {
    title: "Green means in",
    body: "The whole screen turns green so you can see it from across the desk. Scan the same person again today and it turns amber; an expired or frozen membership, or a QR from another gym, turns red. Try the other buttons.",
    target: "scan-result",
    tab: "scanner",
  },
  {
    title: "Forgot their phone? Check them in by name",
    body: "Budi left his phone at home. Find him and check him in, with the same rules as a scan: an expired or frozen member is turned away.",
    target: "desk-checkin",
    action: "Click Check in next to Budi",
    advanceOnClick: true,
    tab: "attendance",
  },
  {
    title: "Walk-ins pay at the desk",
    body: "Someone buys a day pass at the counter. Log it here and it counts as revenue and as a visit today, without making them a member.",
    target: "walk-in",
    tab: "attendance",
  },
  {
    title: "Owner and staff logins",
    body: "Give your front-desk team their own logins. Staff run the day; only owners see finance, refunds and billing. Every payment is recorded under whoever took it.",
    target: "staff",
    tab: "staff",
  },
  {
    title: "Set your own prices",
    body: "Every gym builds its own plans: a name, a length in days and a price. Let's add one more.",
    target: "new-plan",
    action: "Click + New plan",
    advanceOnClick: true,
    tab: "plans",
  },
  {
    title: "Name it and price it",
    body: "Say you want a cheaper option for students. We've filled in an example.",
    target: "plan-form",
    action: "Click Create plan in the form",
    advanceOnSubmit: true,
    tab: "plans",
  },
  {
    title: "It's on sale straight away",
    body: "People can pick it on your sign-up page, and you can choose it when you add a member. Retire a plan with Hide: it stops being offered while members who have it keep their access.",
    target: "new-plan-row",
    tab: "plans",
  },
  {
    title: "Day passes",
    body: "Set what a day pass costs and how long its ticket stays valid. Visitors request one from your join page, or buy one at the desk.",
    target: "day-passes",
    tab: "plans",
  },
  {
    title: "Know where the money is",
    body: "Revenue by month, by plan or class and by how people paid, invoices still unpaid, refunds you gave back, and a CSV export for your accountant. Only the owner sees this page.",
    target: "finance",
    tab: "finance",
  },
  {
    title: "What your members see",
    body: "Members get their own page on their phone, installable like an app: their status and dates, the check-in QR, classes they booked, renewal by bank transfer, and their visits.",
    target: "member-phone",
    tab: "member",
  },
  {
    title: "That's Liftmora",
    body: "Members, check-ins, classes, guests, court bookings and the money, in one place. Ready to run your own gym on Liftmora?",
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

type ScanResult = { kind: "SUCCESS" | "DUPLICATE" | "EXPIRED" | "FROZEN" | "INVALID"; text: string };

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntil(iso: string) {
  return Math.max(0, Math.round((new Date(`${iso}T23:59:59`).getTime() - Date.now()) / 86_400_000));
}

/** The real member list shows a date, so turn "days left" into one. */
function expiryDate(days: number | null) {
  if (days === null) return "—";
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "numeric", year: "numeric" });
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
  const [payFor, setPayFor] = useState<string | null>(null);
  const [paidName, setPaidName] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ amount: "250000", date: todayIso(), note: "Cash at front desk" });
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [newPlanId, setNewPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ name: "Student month", days: "30", price: "180000" });
  const [form, setForm] = useState({ name: "Nadia Rahma", email: "nadia.rahma@mail.com", phone: "0812 5550 0142", plan: "Monthly", paidUntil: "" });
  const [query, setQuery] = useState("");
  const [requests, setRequests] = useState<DemoRequest[]>(INITIAL_REQUESTS);
  const [approvedName, setApprovedName] = useState<string | null>(null);
  const [guests, setGuests] = useState<DemoGuest[]>(GUEST_REQUESTS);
  const [ticketFor, setTicketFor] = useState<DemoGuest | null>(null);
  const [inGym, setInGym] = useState(IN_GYM_NOW);
  const [deskNote, setDeskNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [deskQuery, setDeskQuery] = useState("bu");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scannedToday, setScannedToday] = useState<string[]>([]);

  const onTab = useCallback((t: string) => {
    setTab(t as Tab);
  }, []);

  const steps = useMemo<TourStep[]>(() => STEPS, []);
  const navTab: Tab = tab === "requests" || tab === "guests" ? "members" : tab;

  const expiring = members.filter((m) => m.status === "ACTIVE" && m.expiresInDays !== null && m.expiresInDays <= 7 && m.expiresInDays >= 0);
  const active = members.filter((m) => m.status === "ACTIVE").length;

  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const shownMembers = q
    ? members.filter((m) => m.name.toLowerCase().includes(q) || (qDigits.length > 0 && m.phone.replace(/\D/g, "").includes(qDigits)))
    : members;

  function approveRequest(r: DemoRequest) {
    setRequests((rs) => rs.filter((x) => x.id !== r.id));
    setMembers((ms) => [
      { name: r.name, email: r.email, phone: r.phone, plan: r.plan, status: "ACTIVE", expiresInDays: r.plan === "Quarterly" ? 90 : 30, activated: true },
      ...ms,
    ]);
    setApprovedName(r.name);
  }

  function approveGuest(g: DemoGuest) {
    setGuests((gs) => gs.filter((x) => x.id !== g.id));
    setTicketFor(g);
  }

  /** The front desk checks a member in by hand, with the same rule a scan uses: only an active membership gets in. */
  function deskCheckIn(m: DemoMember) {
    if (m.status !== "ACTIVE") {
      setDeskNote({ ok: false, text: `${m.name} can't check in: membership ${m.status === "FROZEN" ? "is frozen" : "has expired"}.` });
      return;
    }
    const now = new Date();
    const since = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setInGym((xs) => (xs.some((x) => x.name === m.name) ? xs : [...xs, { name: m.name, since }]));
    setDeskNote({ ok: true, text: `${m.name} is checked in.` });
  }

  /** What the staff scanner shows for a member's QR: the same order of checks the real check-in runs. */
  function scanMember(name: string, otherGym = false) {
    const m = members.find((x) => x.name === name);
    if (otherGym || !m) {
      setScan({ kind: "INVALID", text: "This QR isn't for Demo Gym" });
    } else if (m.status === "FROZEN") {
      setScan({ kind: "FROZEN", text: `${m.name}: membership frozen` });
    } else if (m.status !== "ACTIVE") {
      setScan({ kind: "EXPIRED", text: `${m.name}: membership expired` });
    } else if (scannedToday.includes(m.name)) {
      setScan({ kind: "DUPLICATE", text: `${m.name} already checked in today` });
    } else {
      setScannedToday((xs) => [...xs, m.name]);
      setScan({ kind: "SUCCESS", text: `Welcome, ${m.name}` });
    }
  }

  function rejectRequest(r: DemoRequest) {
    setRequests((rs) => rs.filter((x) => x.id !== r.id));
  }

  function addMember(e: React.FormEvent) {
    e.preventDefault();
    const m: DemoMember = {
      name: form.name || "New member",
      email: form.email || "new.member@mail.com",
      phone: form.phone || "0812 0000 0000",
      plan: form.plan,
      status: "ACTIVE",
      expiresInDays: form.paidUntil ? daysUntil(form.paidUntil) : (plans.find((p) => p.name === form.plan)?.days ?? 30),
      activated: false,
    };
    setMembers((ms) => [m, ...ms]);
    setSent(m);
    setShowForm(false);
  }

  function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payFor) return;
    setMembers((ms) => ms.map((m) => (m.name === payFor ? { ...m, status: "ACTIVE", expiresInDays: 30 } : m)));
    setPaidName(payFor);
    setPayFor(null);
  }

  function addPlan(e: React.FormEvent) {
    e.preventDefault();
    const id = `p${Date.now()}`;
    setPlans((ps) => [
      ...ps,
      { id, name: planForm.name || "New plan", days: Number(planForm.days) || 30, price: Number(planForm.price) || 0, onSale: true, members: 0 },
    ]);
    setNewPlanId(id);
    setShowPlanForm(false);
  }

  function restart() {
    setTab("dashboard");
    setMembers(INITIAL_MEMBERS);
    setPlans(INITIAL_PLANS);
    setShowForm(false);
    setSent(null);
    setShowPlanForm(false);
    setPayFor(null);
    setPaidName(null);
    setPayForm({ amount: "250000", date: todayIso(), note: "Cash at front desk" });
    setForm({ name: "Nadia Rahma", email: "nadia.rahma@mail.com", phone: "0812 5550 0142", plan: "Monthly", paidUntil: "" });
    setDeskQuery("bu");
    setScan(null);
    setScannedToday([]);
    setNewPlanId(null);
    setPlanForm({ name: "Student month", days: "30", price: "180000" });
    setQuery("");
    setRequests(INITIAL_REQUESTS);
    setApprovedName(null);
    setGuests(GUEST_REQUESTS);
    setTicketFor(null);
    setInGym(IN_GYM_NOW);
    setDeskNote(null);
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
                aria-current={navTab === t.id ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  navTab === t.id
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
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
            <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>
            <div data-tour="stats" className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="In the gym now" value={String(inGym.length)} />
              <StatCard label="Check-ins today" value={String(CHECKED_IN_TODAY.length + inGym.length - IN_GYM_NOW.length)} />
              <StatCard label="Active members" value={String(active)} />
              <StatCard label="Revenue this month" value={rp(6250000)} sub="+4% vs last month" tone="good" />
            </div>
            <div data-tour="in-gym" className="mb-6 grid gap-6 lg:grid-cols-3">
              <Card title="In the gym now">
                <p className="-mt-2 mb-3 text-xs text-neutral-500">Checked in within the last 3 hours and not checked out</p>
                <ul className="divide-y divide-neutral-800 text-sm">
                  {inGym.map((x) => (
                    <li key={x.name} className="flex justify-between py-2">
                      <span>{x.name}</span>
                      <span className="text-neutral-500">since {x.since}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Checked in today">
                <ul className="divide-y divide-neutral-800 text-sm">
                  {CHECKED_IN_TODAY.map((x) => (
                    <li key={x.name} className="flex justify-between gap-2 py-2">
                      <span>
                        {x.name} <span className="text-neutral-500">· {x.kind}</span>
                      </span>
                      <span className="text-neutral-500">{x.time}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Most visits this month">
                <ul className="divide-y divide-neutral-800 text-sm">
                  {MOST_VISITS.map((x) => (
                    <li key={x.name} className="flex justify-between py-2">
                      <span>{x.name}</span>
                      <span className="text-neutral-400">{x.visits} visits</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <div data-tour="expiring" className="rounded-xl border border-neutral-800">
              <div className="border-b border-neutral-800 px-4 py-3 font-medium">Expiring within 7 days</div>
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-4 py-3 font-normal">Name</th>
                    <th className="px-4 py-3 font-normal">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.map((m) => (
                    <tr key={m.name} className="border-t border-neutral-800">
                      <td className="px-4 py-3">{m.name}</td>
                      <td className="px-4 py-3 text-amber-400">{expiryDate(m.expiresInDays)}</td>
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
            <h1 className="text-2xl font-semibold">Members</h1>
            <p className="mb-4 text-sm text-neutral-400">
              Demo Gym · {members.length} of 100 members on your plan
            </p>
            <button
              data-tour="guests-link"
              onClick={() => setTab("guests")}
              className="mb-4 block text-sm text-neutral-300 underline underline-offset-2 hover:text-white"
            >
              Guest passes (day passes and class tickets for non-members) →
            </button>
            <div className="mb-6 flex flex-wrap items-center gap-3">
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
              <button className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Export CSV</button>
              <button className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Import CSV</button>
            </div>

            {requests.length > 0 && (
              <button
                data-tour="pending-banner"
                onClick={() => setTab("requests")}
                className="mb-6 flex w-full items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm hover:bg-amber-500/20"
              >
                <span>
                  <strong>{requests.length}</strong> pending join request{requests.length === 1 ? "" : "s"} waiting for review
                </span>
                <span className="text-amber-400">Review →</span>
              </button>
            )}

            {showForm && (
              <form data-tour="add-form" onSubmit={addMember} className="mb-6 grid gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5 sm:grid-cols-2">
                <h2 className="col-span-full text-lg font-semibold">Add member</h2>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Full name</span>
                  <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Email (login)</span>
                  <input className={field} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">WhatsApp phone</span>
                  <input className={field} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Plan</span>
                  <select className={field} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                    {plans.filter((p) => p.onSale).map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name} — {rp(p.price)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Paid until</span>
                  <input className={field} type="date" value={form.paidUntil} onChange={(e) => setForm({ ...form, paidUntil: e.target.value })} />
                  <span className="mt-1 block text-xs text-neutral-500">Leave blank to use the plan&apos;s standard length from today.</span>
                </label>
                <p className="col-span-full text-xs text-neutral-500">
                  No online payment is collected here — the member is marked active and paid straight away, recorded as a cash payment.
                </p>
                <div className="col-span-full flex gap-3">
                  <button type="submit" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                    Add member
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {sent && (
              <div data-tour="whatsapp" className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <p className="mb-3 text-sm text-neutral-300">
                  {sent.name} was added and is active. This welcome is on its way by email (or WhatsApp, if you pick it):
                </p>
                <div className="max-w-sm rounded-2xl rounded-tl-sm bg-[#d9fdd3] p-3 text-sm leading-relaxed text-[#111b21] shadow">
                  Hi {sent.name}! You&apos;ve been added to Demo Gym.
                  <br />
                  Your membership is active until {expiryDate(sent.expiresInDays)}.
                  <br />
                  Set your password and see your check-in QR here: <span className="text-[#027eb5] underline">activate/8f3k2q…</span>
                </div>
              </div>
            )}

            {payFor && (
              <form data-tour="record-pay-form" onSubmit={recordPayment} className="mb-6 grid gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5 sm:grid-cols-[1fr_1fr_1fr_1.4fr_auto]">
                <p className="col-span-full text-sm text-neutral-300">Record a payment for <span className="font-semibold text-white">{payFor}</span></p>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Plan paid for</span>
                  <select className={field} defaultValue="Monthly">
                    {plans.filter((p) => p.onSale).map((p) => (
                      <option key={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Amount received (Rp)</span>
                  <input className={field} type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Date received</span>
                  <input className={field} type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Note (optional)</span>
                  <input className={field} value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
                </label>
                <button type="submit" className="self-end rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                  Save payment
                </button>
              </form>
            )}

            {paidName && !payFor && (
              <p className="mb-6 rounded-lg border border-emerald-800 bg-emerald-950 px-4 py-3 text-sm text-emerald-400">
                Recorded. {paidName} is active for 30 days, and a receipt is on its way.
              </p>
            )}

            <div className="mb-4 flex items-center gap-3">
              <input
                data-tour="member-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or phone number"
                aria-label="Search members"
                className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-white placeholder:text-neutral-500 outline-none focus:border-plate-blue"
              />
              {q && (
                <span className="whitespace-nowrap text-sm text-neutral-400">
                  {shownMembers.length} of {members.length}
                </span>
              )}
            </div>

            <div data-tour="member-table" className="overflow-x-auto rounded-xl border border-neutral-800">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-3 py-3 font-normal">Name</th>
                    <th className="px-3 py-3 font-normal">Email</th>
                    <th className="px-3 py-3 font-normal">Phone</th>
                    <th className="px-3 py-3 font-normal">Plan</th>
                    <th className="px-3 py-3 font-normal">Status</th>
                    <th className="px-3 py-3 font-normal">Expiry</th>
                    <th className="px-3 py-3 font-normal">Activated</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {shownMembers.map((m) => (
                    <tr
                      key={m.name}
                      data-tour={m.name === paidName ? "paid-row" : m.name === approvedName ? "approved-row" : undefined}
                      className="border-t border-neutral-800"
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-medium">{m.name}</td>
                      <td className="max-w-[120px] truncate px-3 py-3 text-neutral-400">{m.email}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-neutral-300">{m.phone}</td>
                      <td className="px-3 py-3">{m.plan}</td>
                      <td className="px-3 py-3">
                        <StatusPill status={m.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-neutral-400">{expiryDate(m.expiresInDays)}</td>
                      <td className="px-3 py-3 text-neutral-400">{m.activated ? "Yes" : "Pending"}</td>
                      <td className="px-3 py-3">
                        <div className="ml-auto flex w-[200px] flex-wrap justify-end gap-1.5">
                          <button
                            data-tour={m.name === "Andi Wijaya" ? "record-pay-btn" : undefined}
                            onClick={() => setPayFor(m.name)}
                            className="whitespace-nowrap rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800"
                          >
                            Record payment
                          </button>
                          <button className="whitespace-nowrap rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800">Send reminder</button>
                          <button className="whitespace-nowrap rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800">Resend QR link</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {shownMembers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
                        No members match &ldquo;{query.trim()}&rdquo;.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "requests" && (
          <div>
            <button onClick={() => setTab("members")} className="text-sm text-neutral-400 hover:text-white">
              ← Members
            </button>
            <h1 className="mt-2 text-2xl font-semibold">Pending requests</h1>
            <p className="mb-8 text-sm text-neutral-400">
              People who submitted a bank-transfer join request. Confirm the payment before approving.
            </p>
            {requests.length === 0 ? (
              <p className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-8 text-center text-neutral-500">
                No pending requests.
              </p>
            ) : (
              <div className="space-y-4">
                {requests.map((r, i) => (
                  <div
                    key={r.id}
                    data-tour={i === 0 ? "request-card" : undefined}
                    className="rounded-xl border border-amber-500/30 bg-neutral-900 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex gap-4">
                        <div
                          aria-label="Transfer receipt"
                          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-center text-[10px] leading-tight text-neutral-500"
                        >
                          Transfer
                          <br />
                          receipt
                        </div>
                        <div>
                          <p className="font-medium">{r.name}</p>
                          <p className="text-sm text-neutral-400">
                            {r.plan} · {rp(r.amount)}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {r.email} · {r.phone}
                          </p>
                          <p className="text-xs text-neutral-600">Submitted {r.submitted}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          data-tour={i === 0 ? "approve-btn" : undefined}
                          onClick={() => approveRequest(r)}
                          className="whitespace-nowrap rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-[#ffffff] hover:bg-emerald-500"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => rejectRequest(r)}
                          className="whitespace-nowrap rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "plans" && (
          <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Membership plans</h1>
              <button
                data-tour="new-plan"
                onClick={() => setShowPlanForm((x) => !x)}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200"
              >
                + New plan
              </button>
            </div>

            {showPlanForm && (
              <form data-tour="plan-form" onSubmit={addPlan} className="mb-6 grid gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Plan name</span>
                  <input className={field} value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} />
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Length (days)</span>
                  <input className={field} type="number" min={1} value={planForm.days} onChange={(e) => setPlanForm({ ...planForm, days: e.target.value })} />
                </label>
                <label className="text-sm text-neutral-300">
                  <span className="mb-1 block">Price (Rp)</span>
                  <input className={field} type="number" min={1000} step={1000} value={planForm.price} onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })} />
                </label>
                <button type="submit" className="self-end rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                  Create plan
                </button>
              </form>
            )}

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
                    <tr key={p.id} data-tour={p.id === newPlanId ? "new-plan-row" : undefined} className="border-t border-neutral-800">
                      <td className="px-4 py-3 font-medium">{p.name}</td>
                      <td className="px-4 py-3 text-neutral-400">{p.days} days</td>
                      <td className="px-4 py-3">{rp(p.price)}</td>
                      <td className="px-4 py-3 text-neutral-400">{p.members}</td>
                      <td className="px-4 py-3">
                        <span className={p.onSale ? "text-emerald-400" : "text-neutral-500"}>{p.onSale ? "On sale" : "Hidden"}</span>
                      </td>
                      <td className="flex justify-end gap-2 px-4 py-3">
                        <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">Edit</button>
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
            <p className="mt-3 text-xs text-neutral-500">
              Hidden plans stay on existing members but can&apos;t be chosen for new members or renewals. A plan can only be deleted while nobody has used it.
            </p>
            <div data-tour="day-passes" className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-lg font-medium">Day passes</h2>
              <p className="mt-1 text-sm text-neutral-400">
                For visitors who just want to try the gym. They request it from your join page, you approve, and they get a one-time QR ticket that works any day until it expires. Guests are never added as members.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {DAY_PASSES.map((d) => (
                  <li key={d.name} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {d.name} · {rp(d.price)} · valid {d.validDays} days
                    </span>
                    <span className="flex gap-2">
                      <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">Hide</button>
                      <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">Delete</button>
                    </span>
                  </li>
                ))}
              </ul>
              <button className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Add day pass</button>
            </div>
          </div>
        )}

        {tab === "poster" && (
          <div className="flex flex-col items-center text-center">
            <h1 className="mb-6 text-2xl font-semibold">Demo Gym — Check-in</h1>
            <div data-tour="poster" className="rounded-2xl bg-[#ffffff] p-6">
              <FakeQr />
            </div>
            <p className="mt-6 max-w-sm text-sm text-neutral-400">Members: open your Liftmora app and scan this code to check yourself in.</p>
            <button className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">Print</button>
            <p className="mt-4 max-w-md text-xs text-neutral-600">
              This code doesn&apos;t change — print it once and mount it at the entrance. Staff can still scan a member&apos;s own QR from the staff scanner.
            </p>
          </div>
        )}

        {tab === "scanner" && (
          <div>
            <h1 className="text-2xl font-semibold">Staff scanner</h1>
            <p className="mb-6 text-sm text-neutral-400">Point the camera at a member&apos;s QR or a guest&apos;s ticket.</p>
            <div className="mx-auto mb-4 flex max-w-md flex-wrap justify-center gap-2">
              <span className="w-full text-center text-xs text-neutral-500">Pretend to scan:</span>
              <button
                data-tour="scan-btn"
                onClick={() => scanMember("Sari Dewi")}
                className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200"
              >
                Scan Sari&apos;s QR
              </button>
              <button onClick={() => scanMember("Andi Wijaya")} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
                Andi (expired)
              </button>
              <button onClick={() => scanMember("Eko Nugroho")} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
                Eko (frozen)
              </button>
              <button onClick={() => scanMember("Sari Dewi", true)} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
                Another gym&apos;s QR
              </button>
            </div>
            <div className="relative mx-auto flex aspect-[4/3] max-w-md items-center justify-center overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
              <div className="h-1/2 w-1/2 rounded-xl border-2 border-dashed border-neutral-600" />
              <p className="absolute bottom-3 text-xs text-neutral-500">Camera preview</p>
              {scan && (
                <button
                  data-tour="scan-result"
                  onClick={() => setScan(null)}
                  className={`absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center ${
                    scan.kind === "SUCCESS" ? "bg-emerald-600" : scan.kind === "DUPLICATE" ? "bg-amber-500" : "bg-red-600"
                  } text-[#ffffff]`}
                >
                  <span className="text-3xl font-bold tracking-wide">{scan.kind}</span>
                  <span className="text-lg">{scan.text}</span>
                  <span className="text-xs opacity-80">Tap to scan the next one</span>
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "finance" && (
          <div data-tour="finance">
            <h1 className="mb-6 text-2xl font-semibold">Finance</h1>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Revenue this month" value={rp(6250000)} sub={`+4% vs last month · ${rp(200000)} from classes · ${rp(140000)} from day passes · after ${rp(120000)} refunded`} tone="good" />
              <StatCard label="Last month" value={rp(6000000)} />
              <StatCard label="Last 12 months" value={rp(24850000)} />
              <StatCard label="Awaiting payment" value={rp(250000)} sub="1 unpaid invoice" tone="bad" />
            </div>
            <div className="mb-6">
              <Card title="Revenue — last 12 months (after refunds)">
                <BarChart data={REVENUE_MONTHS} format={(n) => `${(n / 1_000_000).toFixed(1)}M`} />
              </Card>
            </div>
            <div className="mb-6">
              <Card title="Export for your accountant">
                <div className="flex flex-wrap items-center gap-3">
                  <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">Download transactions</button>
                  <button className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800">Download monthly summary</button>
                  <span className="text-xs text-neutral-500">CSV files for Excel or Google Sheets: every payment and refund, or one row per month.</span>
                </div>
              </Card>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="This month by plan or class">
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
            <div className="mt-6">
              <Card title="Refunds">
                <p className="mb-3 text-sm text-neutral-400">Money you gave back comes off revenue on the day it went back. One recorded by mistake is voided, never silently deleted.</p>
                <ul className="space-y-2 text-sm">
                  {REFUNDS.map((r) => (
                    <li key={r.to + r.date} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {r.date} · {r.to} <span className="text-neutral-500">· {r.forWhat} · {r.reason}</span>
                      </span>
                      <span className="text-red-400">−{rp(r.amount)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        )}

        {tab === "classes" && (
          <div>
            <h1 className="mb-6 text-2xl font-semibold">Classes</h1>
            <div data-tour="class-list" className="mb-6 overflow-x-auto rounded-xl border border-neutral-800">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-4 py-3 font-normal">Class</th>
                    <th className="px-4 py-3 font-normal">Next session</th>
                    <th className="px-4 py-3 font-normal">Spots</th>
                    <th className="px-4 py-3 font-normal">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {CLASSES.map((c) => (
                    <tr key={c.id} className="border-t border-neutral-800">
                      <td className="px-4 py-3 font-medium">
                        {c.name} <span className="text-neutral-500">· {c.coach}</span>
                      </td>
                      <td className="px-4 py-3 text-neutral-300">{c.when}</td>
                      <td className="px-4 py-3">
                        {c.booked >= c.capacity ? <span className="text-amber-400">Full ({c.capacity})</span> : <span>{c.booked} / {c.capacity}</span>}
                      </td>
                      <td className="px-4 py-3 text-neutral-300">{c.price > 0 ? rp(c.price) : "Included"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div data-tour="roster" className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="mb-3 font-medium">Morning Yoga · Sat 31 Oct · roster</p>
              <ul className="divide-y divide-neutral-800 text-sm">
                {ROSTER.map((r) => (
                  <li key={r.name} className="flex items-center justify-between py-2">
                    <span>{r.name}</span>
                    <span className={r.status === "Came" ? "text-emerald-400" : r.status === "No-show" ? "text-red-400" : "text-neutral-400"}>{r.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {tab === "guests" && (
          <div>
            <button onClick={() => setTab("members")} className="text-sm text-neutral-400 hover:text-white">
              ← Members
            </button>
            <h1 className="mt-2 mb-2 text-2xl font-semibold">Guest tickets</h1>
            <p className="mb-6 text-sm text-neutral-400">
              Non-members asking for a class spot or a day pass. Approve to send their one-time QR ticket; scan it on the check-in scanner.
            </p>
            {ticketFor && (
              <div data-tour="guest-ticket" className="mb-6 flex flex-wrap items-center gap-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="rounded-xl bg-[#ffffff] p-3">
                  <div className="scale-[0.55] origin-top-left" style={{ width: 124, height: 124 }}>
                    <FakeQr />
                  </div>
                </div>
                <div className="max-w-sm text-sm">
                  <p className="mb-2 text-emerald-400">Approved. {ticketFor.name}&apos;s ticket is on its way by email (or WhatsApp, if you pick it).</p>
                  <div className="rounded-2xl rounded-tl-sm bg-[#d9fdd3] p-3 leading-relaxed text-[#111b21] shadow">
                    Hi {ticketFor.name.split(" ")[0]}, you&apos;re approved for {ticketFor.item} at Demo Gym, valid for 30 days. Show this one-time QR ticket at the front desk:{" "}
                    <span className="text-[#027eb5] underline">ticket/7Hq…</span>
                  </div>
                </div>
              </div>
            )}
            {guests.length === 0 ? (
              <p className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-8 text-center text-neutral-500">No requests waiting.</p>
            ) : (
              <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
                {guests.map((g, i) => (
                  <li key={g.id} data-tour={i === 0 ? "guest-card" : undefined} className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div>
                      <p className="font-medium">
                        {g.name} <span className="text-sm text-neutral-500">{g.phone}</span>
                      </p>
                      <p className="text-sm text-neutral-400">
                        {g.item} · {rp(g.amount)}
                      </p>
                      <p className="text-sm text-neutral-500">{g.hasProof ? <span className="underline underline-offset-2">View transfer proof</span> : "No proof attached. Check your bank before approving."}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        data-tour={i === 0 ? "guest-approve" : undefined}
                        onClick={() => approveGuest(g)}
                        className="whitespace-nowrap rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-[#ffffff] hover:bg-emerald-500"
                      >
                        {g.amount > 0 ? "Payment received — approve" : "Approve"}
                      </button>
                      <button onClick={() => setGuests((gs) => gs.filter((x) => x.id !== g.id))} className="whitespace-nowrap rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "fields" && (
          <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Fields · Today</h1>
              <div data-tour="field-actions" className="flex gap-2">
                <button className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">+ Add booking</button>
                <button className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">Block time</button>
              </div>
            </div>
            <div data-tour="field-timeline" className="space-y-6">
              {FIELDS.map((f) => {
                const span = f.closes - f.opens;
                const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                return (
                  <div key={f.id}>
                    <p className="mb-1 text-sm font-medium">
                      {f.name} <span className="text-neutral-500">{f.sport} · {rp(f.perHour)}/hr · {clock(f.opens)}–{clock(f.closes)}</span>
                    </p>
                    <div className="relative h-9 rounded-md border border-neutral-800 bg-neutral-900">
                      {f.bookings.map((b) => (
                        <div
                          key={b.name + b.start}
                          title={`${clock(b.start)}–${clock(b.end)} ${b.name}`}
                          className={`absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-[11px] leading-7 ${
                            b.status === "Blocked" ? "bg-neutral-600 text-white" : b.status === "Came" ? "bg-emerald-500 text-neutral-950" : "bg-plate-yellow text-neutral-950"
                          }`}
                          style={{ left: `${((b.start - f.opens) / span) * 100}%`, width: `${((b.end - b.start) / span) * 100}%` }}
                        >
                          {b.status === "Blocked" ? "Blocked" : b.name}
                        </div>
                      ))}
                    </div>
                    <ul className="mt-2 text-sm text-neutral-400">
                      {f.bookings.map((b) => (
                        <li key={b.name + b.start}>
                          {clock(b.start)}–{clock(b.end)} · {b.status === "Blocked" ? `Blocked: ${b.name}` : b.name}
                          {b.status !== "Blocked" && <span className="text-neutral-500"> · {b.status}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "attendance" && (
          <div>
            <h1 className="text-2xl font-semibold">Attendance</h1>
            <p className="mb-6 text-sm text-neutral-400">Demo Gym · log visits by hand when there&apos;s no QR to scan.</p>
            <div className="mb-6 grid gap-6 lg:grid-cols-2">
              <section data-tour="walk-in" className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-lg font-medium">Walk-in day pass</h2>
                <p className="mt-1 text-sm text-neutral-400">Paid at the desk. Counts as revenue and as a visit today.</p>
                <div className="mt-4 space-y-3">
                  <select className={field} aria-label="Day pass plan">
                    {DAY_PASSES.map((d) => (
                      <option key={d.name}>
                        {d.name} · {rp(d.price)}
                      </option>
                    ))}
                  </select>
                  <input className={field} placeholder="Name" aria-label="Name" />
                  <input className={field} placeholder="Phone (optional)" aria-label="Phone" />
                  <input className={field} defaultValue={DAY_PASSES[0].price} type="number" aria-label="Amount paid" />
                  <button type="button" className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                    Log walk-in
                  </button>
                </div>
              </section>
              <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-lg font-medium">Check in a member</h2>
                <p className="mt-1 text-sm text-neutral-400">No QR handy? Find them by name. Same rules as a scan.</p>
                <input value={deskQuery} onChange={(e) => setDeskQuery(e.target.value)} className={`${field} mt-4`} placeholder="Search name…" aria-label="Search members" />
                <ul className="mt-3 divide-y divide-neutral-800 rounded-lg border border-neutral-800 text-sm">
                  {members
                    .filter((m) => deskQuery.trim().length >= 1 && m.name.toLowerCase().includes(deskQuery.trim().toLowerCase()))
                    .slice(0, 6)
                    .map((m) => (
                      <li key={m.name} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span>
                          {m.name}
                          {m.status !== "ACTIVE" && <span className="ml-2 text-xs text-amber-400">{m.status.toLowerCase().replace("_", " ")}</span>}
                        </span>
                        <button
                          data-tour={m.name === "Budi Santoso" ? "desk-checkin" : undefined}
                          onClick={() => deskCheckIn(m)}
                          className="whitespace-nowrap rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
                        >
                          Check in
                        </button>
                      </li>
                    ))}
                </ul>
                {deskNote && <p className={`mt-3 text-sm ${deskNote.ok ? "text-emerald-400" : "text-amber-400"}`}>{deskNote.text}</p>}
              </section>
            </div>
            <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-lg font-medium">
                Today <span className="text-neutral-500">({CHECKED_IN_TODAY.length + inGym.length - IN_GYM_NOW.length})</span>
              </h2>
              <ul className="mt-3 divide-y divide-neutral-800 text-sm">
                {inGym.slice(IN_GYM_NOW.length).map((x) => (
                  <li key={x.name} className="flex justify-between py-2">
                    <span>
                      {x.name} <span className="text-neutral-500">· Member</span>
                    </span>
                    <span className="text-neutral-500">{x.since}</span>
                  </li>
                ))}
                {CHECKED_IN_TODAY.map((x) => (
                  <li key={x.name} className="flex justify-between py-2">
                    <span>
                      {x.name} <span className="text-neutral-500">· {x.kind}</span>
                    </span>
                    <span className="text-neutral-500">{x.time}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        {tab === "staff" && (
          <div>
            <h1 className="mb-6 text-2xl font-semibold">Staff</h1>
            <div data-tour="staff" className="overflow-x-auto rounded-xl border border-neutral-800">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-4 py-3 font-normal">Name</th>
                    <th className="px-4 py-3 font-normal">Role</th>
                    <th className="px-4 py-3 font-normal">Can do</th>
                  </tr>
                </thead>
                <tbody>
                  {STAFF.map((x) => (
                    <tr key={x.email} className="border-t border-neutral-800">
                      <td className="px-4 py-3">
                        <span className="font-medium">{x.name}</span>
                        <span className="block text-xs text-neutral-500">{x.email}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={x.role === "Owner" ? "text-plate-yellow" : "text-neutral-300"}>{x.role}</span>
                      </td>
                      <td className="px-4 py-3 text-neutral-400">{x.can}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-neutral-500">New staff get an email to set their own password. Remove someone and their login stops working at once; what they recorded stays.</p>
          </div>
        )}

        {tab === "member" && (
          <div className="flex flex-col items-center">
            <h1 className="mb-6 text-2xl font-semibold">What a member sees</h1>
            <div data-tour="member-phone" className="w-[300px] rounded-[2.2rem] border-4 border-neutral-700 bg-neutral-950 p-4 shadow-2xl">
              <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-neutral-700" />
              <p className="text-xs text-neutral-500">Demo Gym</p>
              <p className="mb-3 text-lg font-semibold">Hi, Sari</p>
              <div className="mb-3 rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2 text-sm">
                <span className="font-medium text-emerald-400">Active</span>
                <span className="block text-xs text-neutral-300">Annual · until 28 May 2027</span>
              </div>
              <div className="mb-3 flex justify-center rounded-xl bg-[#ffffff] p-2">
                <div className="origin-top scale-[0.7]" style={{ width: 224, height: 157 }}>
                  <FakeQr />
                </div>
              </div>
              <p className="mb-3 text-center text-xs text-neutral-500">Show at the door, or scan the poster</p>
              <div className="mb-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
                <span className="text-xs text-neutral-500">Booked</span>
                <span className="block">Morning Yoga · Sat 07:00</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
                  <span className="text-xs text-neutral-500">This month</span>
                  <span className="block font-semibold">14 visits</span>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
                  <span className="text-xs text-neutral-500">Renew</span>
                  <span className="block font-semibold">By transfer</span>
                </div>
              </div>
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
