"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export interface PlanOption { id: string; name: string; price: number }
export interface MemberOption { id: string; fullName: string; status: string }
export interface EntryRow { id: string; name: string; kind: string; time: string }

const input = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none placeholder:text-neutral-500 focus:border-plate-blue";
const card = "rounded-xl border border-neutral-800 bg-neutral-900 p-5";
const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

const RESULT_TEXT: Record<string, string> = {
  SUCCESS: "Checked in",
  DUPLICATE: "Already checked in",
  EXPIRED: "Membership expired, not checked in",
  FROZEN: "Membership frozen, not checked in",
};

export default function AttendanceDesk({ slug, plans, members, entries }: { slug: string; plans: PlanOption[]; members: MemberOption[]; entries: EntryRow[] }) {
  const router = useRouter();

  // Walk-in day pass
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState<string>(plans[0] ? String(plans[0].price) : "");
  const [walkBusy, setWalkBusy] = useState(false);
  const [walkMsg, setWalkMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Manual member check-in
  const [query, setQuery] = useState("");
  const [memBusy, setMemBusy] = useState<string | null>(null);
  const [memMsg, setMemMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q.length < 2 ? [] : members.filter((m) => m.fullName.toLowerCase().includes(q)).slice(0, 8);
  }, [query, members]);

  function pickPlan(id: string) {
    setPlanId(id);
    const p = plans.find((x) => x.id === id);
    if (p) setAmount(String(p.price));
  }

  async function logWalkIn(e: React.FormEvent) {
    e.preventDefault();
    setWalkBusy(true);
    setWalkMsg(null);
    const res = await fetch(`/api/${slug}/attendance/walk-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayPassPlanId: planId, fullName: name, phone: phone.trim() || undefined, amount: amount === "" ? undefined : Number(amount) }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setWalkBusy(false);
    if (!res || !res.ok) return setWalkMsg({ ok: false, text: body?.error ?? "Something went wrong. Try again." });
    setWalkMsg({ ok: true, text: `${name} logged in.` });
    setName("");
    setPhone("");
    router.refresh();
  }

  async function checkIn(m: MemberOption) {
    setMemBusy(m.id);
    setMemMsg(null);
    const res = await fetch(`/api/${slug}/attendance/member`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: m.id }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setMemBusy(null);
    if (!res || !res.ok) return setMemMsg({ ok: false, text: body?.error ?? "Something went wrong. Try again." });
    setMemMsg({ ok: body.result === "SUCCESS", text: `${m.fullName}: ${body.message ?? RESULT_TEXT[body.result] ?? body.result}` });
    if (body.result === "SUCCESS") setQuery("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <section className={card}>
          <h2 className="text-lg font-medium">Walk-in day pass</h2>
          <p className="mt-1 text-sm text-neutral-400">Paid at the desk. Counts as revenue and as a visit today.</p>
          {plans.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">No active day pass plans. The owner can add one under Plans.</p>
          ) : (
            <form onSubmit={logWalkIn} className="mt-4 space-y-3">
              <select value={planId} onChange={(e) => pickPlan(e.target.value)} className={input} aria-label="Day pass plan">
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {rupiah(p.price)}</option>)}
              </select>
              <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Name" aria-label="Name" />
              <input type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} className={input} placeholder="Phone (optional)" aria-label="Phone" />
              <input type="number" min={0} step={1000} value={amount} onChange={(e) => setAmount(e.target.value)} className={input} placeholder="Amount paid (Rp)" aria-label="Amount paid" />
              {walkMsg && <p className={`text-sm ${walkMsg.ok ? "text-emerald-400" : "text-red-400"}`} role={walkMsg.ok ? "status" : "alert"}>{walkMsg.text}</p>}
              <button disabled={walkBusy} className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
                {walkBusy ? "Saving…" : "Log walk-in"}
              </button>
            </form>
          )}
        </section>

        <section className={card}>
          <h2 className="text-lg font-medium">Check in a member</h2>
          <p className="mt-1 text-sm text-neutral-400">No QR handy? Find them by name. Same rules as a scan.</p>
          <input value={query} onChange={(e) => setQuery(e.target.value)} className={`${input} mt-4`} placeholder="Search name…" aria-label="Search members" />
          {matches.length > 0 && (
            <ul className="mt-3 divide-y divide-neutral-800 rounded-lg border border-neutral-800">
              {matches.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    {m.fullName}
                    {m.status !== "ACTIVE" && <span className="ml-2 text-xs text-amber-400">{m.status.toLowerCase().replace("_", " ")}</span>}
                  </span>
                  <button onClick={() => checkIn(m)} disabled={memBusy === m.id} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50">
                    {memBusy === m.id ? "…" : "Check in"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {memMsg && <p className={`mt-3 text-sm ${memMsg.ok ? "text-emerald-400" : "text-amber-400"}`} role="status">{memMsg.text}</p>}
        </section>
      </div>

      <section className={card}>
        <h2 className="text-lg font-medium">Today <span className="text-neutral-500">({entries.length})</span></h2>
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">No one yet today.</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-800" data-testid="attendance-today">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{e.name} <span className="text-neutral-500">· {e.kind}</span></span>
                <span className="text-neutral-400">{e.time}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
