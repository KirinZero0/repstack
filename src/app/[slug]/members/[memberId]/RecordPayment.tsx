"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PlanOption {
  id: string;
  name: string;
  price: number;
  days: number;
}

const inputCls =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-plate-blue";

export function RecordPaymentForm({
  slug,
  memberId,
  plans,
  defaultPlanId,
  today,
}: {
  slug: string;
  memberId: string;
  plans: PlanOption[];
  defaultPlanId: string;
  today: string;
}) {
  const router = useRouter();
  const first = plans.find((p) => p.id === defaultPlanId) ?? plans[0];
  const [planId, setPlanId] = useState(first?.id ?? "");
  const [amount, setAmount] = useState(String(first?.price ?? ""));
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const plan = plans.find((p) => p.id === planId);

  if (plans.length === 0) {
    return <p className="text-sm text-neutral-400">Create a membership plan first, then you can record payments against it.</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await fetch(`/api/${slug}/members/${memberId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, amount: Number(amount), paidOn, note: note || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(typeof body.error === "string" ? body.error : "Could not record the payment.");
      return;
    }
    setDone(`Recorded. Active until ${new Date(body.membershipExpiry).toLocaleDateString("id-ID")}.`);
    setNote("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Plan paid for</span>
        <select
          value={planId}
          onChange={(e) => {
            setPlanId(e.target.value);
            const p = plans.find((x) => x.id === e.target.value);
            if (p) setAmount(String(p.price));
          }}
          className={inputCls}
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.days} days
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Amount received (Rp)</span>
        <input required type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        {plan && Number(amount) !== plan.price && (
          <span className="mt-1 block text-xs text-neutral-500">Plan price is Rp {plan.price.toLocaleString("id-ID")}. Change the amount for a discount.</span>
        )}
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Date received</span>
        <input required type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputCls} />
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Note (optional)</span>
        <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="Cash at front desk" />
      </label>

      {error && <p className="col-span-full text-sm text-red-400">{error}</p>}
      {done && <p className="col-span-full text-sm text-emerald-400">{done}</p>}

      <div className="col-span-full">
        <button type="submit" disabled={busy} className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-60">
          {busy ? "Saving…" : "Record payment"}
        </button>
        <p className="mt-2 text-xs text-neutral-500">The membership is extended right away and the member gets a WhatsApp receipt.</p>
      </div>
    </form>
  );
}

export function VoidPaymentButton({ slug, memberId, paymentId }: { slug: string; memberId: string; paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function voidIt() {
    if (!window.confirm("Void this payment? It's removed from revenue and the days it added are taken back.")) return;
    setBusy(true);
    const res = await fetch(`/api/${slug}/members/${memberId}/payments/${paymentId}/void`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      window.alert(typeof b.error === "string" ? b.error : "Could not void the payment.");
      return;
    }
    router.refresh();
  }

  return (
    <button onClick={voidIt} disabled={busy} className="rounded-lg border border-neutral-700 px-2.5 py-1 text-xs text-red-400 hover:bg-neutral-800 disabled:opacity-50">
      {busy ? "Voiding…" : "Void"}
    </button>
  );
}
