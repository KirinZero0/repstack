"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const primary =
  "rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-60";
const ghost = "rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";

async function go(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data } as { ok: boolean; data: { url?: string; changed?: boolean; plan?: string; error?: string } };
}

/** Opens the payable invoice for the gym's own subscription. */
export function PayNowButton({ slug, label }: { slug: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    const { ok, data } = await go(`/api/g/${slug}/billing/pay`, {});
    if (!ok || !data.url) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setBusy(false);
      return;
    }
    window.location.href = data.url;
  }

  return (
    <div>
      <button type="button" onClick={pay} disabled={busy} className={primary}>
        {busy ? "Opening payment…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export interface PlanOption {
  id: string;
  name: string;
  price: number;
  interval: string;
  maxMembers: number;
  maxStaff: number;
  maxWhatsappPerMonth: number;
  /** True when it costs no more and gives no more, so switching is immediate and free. */
  immediate: boolean;
}

/** Switch to another Iron Ledger plan. Bigger or dearer plans are paid for first; smaller ones apply at once. */
export function PlanSwitcher({ slug, options }: { slug: string; options: PlanOption[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function choose(o: PlanOption) {
    if (o.immediate && !window.confirm(`Switch to ${o.name} now? It applies immediately and you keep the time you've already paid for.`)) return;
    setBusyId(o.id);
    setError(null);
    setNotice(null);
    const { ok, data } = await go(`/api/g/${slug}/subscription`, { saasPlanId: o.id });
    setBusyId(null);
    if (!ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    setNotice(`You're now on ${data.plan}.`);
    router.refresh();
  }

  return (
    <div>
      <ul className="divide-y divide-neutral-800">
        {options.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium text-white">{o.name}</p>
              <p className="text-sm text-neutral-400">
                Rp {o.price.toLocaleString("id-ID")} / {o.interval === "annual" ? "year" : "month"} · {o.maxMembers.toLocaleString("id-ID")} members ·{" "}
                {o.maxStaff} staff · {o.maxWhatsappPerMonth.toLocaleString("id-ID")} WhatsApp a month
              </p>
            </div>
            <button type="button" onClick={() => choose(o)} disabled={busyId !== null} className={ghost}>
              {busyId === o.id ? "Working…" : o.immediate ? "Switch now" : `Pay Rp ${o.price.toLocaleString("id-ID")} to switch`}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-400">{notice}</p>}
    </div>
  );
}
