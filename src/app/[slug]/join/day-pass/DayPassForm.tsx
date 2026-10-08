"use client";

import { useState } from "react";
import TransferPayment, { type BankInfo } from "@/components/TransferPayment";

export interface DayPassOption {
  id: string;
  name: string;
  price: number;
}

const input =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none placeholder:text-neutral-500 focus:border-plate-blue";
const rp = (n: number) => (n === 0 ? "Free" : `Rp ${n.toLocaleString("id-ID")}`);

export default function DayPassForm({ slug, plans, dateRange, bank }: { slug: string; plans: DayPassOption[]; dateRange: { min: string; max: string }; bank: BankInfo | null }) {
  const [dayPassPlanId, setDayPassPlanId] = useState(plans[0].id);
  const [visitDate, setVisitDate] = useState(dateRange.min);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const price = plans.find((p) => p.id === dayPassPlanId)?.price ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("dayPassPlanId", dayPassPlanId);
      fd.set("visitDate", visitDate);
      fd.set("fullName", fullName);
      fd.set("phone", phone);
      if (proof && price > 0) fd.set("proof", proof);
      const res = await fetch(`/api/${slug}/guest-passes`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Something went wrong. Please try again.");
      else setSent(true);
    } catch {
      setError("Network problem. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6" data-testid="guest-request-sent">
        <p className="text-lg font-medium">Request sent</p>
        <p className="mt-2 text-neutral-400">
          The gym will check your payment and approve it. Your one-time QR ticket then arrives on WhatsApp — show it at the front desk.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-neutral-300">Day pass</legend>
        <div className="space-y-2">
          {plans.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 has-[:checked]:border-plate-blue">
              <input type="radio" name="dayPassPlanId" value={p.id} checked={dayPassPlanId === p.id} onChange={() => setDayPassPlanId(p.id)} />
              <span>
                <span className="block font-medium">{p.name}</span>
                <span className="block text-sm text-neutral-400">{rp(p.price)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Day you&apos;re coming</span>
        <input required type="date" min={dateRange.min} max={dateRange.max} value={visitDate} onChange={(e) => setVisitDate(e.target.value)} className={input} />
      </label>
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Your name</span>
        <input required minLength={2} maxLength={80} value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} />
      </label>
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">WhatsApp number</span>
        <input required type="tel" minLength={6} maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} className={input} placeholder="0812…" />
      </label>
      <TransferPayment amount={price} bank={bank} onProof={setProof} />
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      <button disabled={busy} className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
        {busy ? "Sending…" : "Request a day pass"}
      </button>
    </form>
  );
}
