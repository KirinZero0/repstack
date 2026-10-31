"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface RefundRow {
  id: string;
  /** YYYY-MM-DD in the gym's timezone. */
  date: string;
  recipientName: string;
  reason: string;
  categoryLabel: string;
  methodLabel: string;
  amount: number;
  note: string | null;
  recordedBy: string | null;
}

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const btn = "whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";
const primary = "whitespace-nowrap rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-50";
const input = "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500";

/** The owner records money given back; Finance subtracts it on that day. Recent refunds are listed with a remove. */
export default function RefundsCard({ slug, today, refunds }: { slug: string; today: string; refunds: RefundRow[] }) {
  const router = useRouter();
  const empty = { amount: "", recipientName: "", reason: "", category: "OTHER", method: "CASH", date: today, note: "" };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/${slug}/refunds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: Number(form.amount), note: form.note || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(typeof body.error === "string" ? body.error : "Couldn't record the refund.");
    setForm(empty);
    setSaved(true);
    setOpen(false);
    router.refresh();
  }

  async function remove(r: RefundRow) {
    if (!window.confirm(`Remove the ${rp(r.amount)} refund to ${r.recipientName}? Finance stops subtracting it.`)) return;
    const res = await fetch(`/api/${slug}/refunds/${r.id}`, { method: "DELETE" });
    if (!res.ok) return setError("Couldn't remove it.");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-400">Money you gave back (a no-show, a cancelled membership, a goodwill refund). It is taken off revenue on the day it went back.</p>
        {!open && (
          <button className={primary} onClick={() => { setOpen(true); setSaved(false); }}>
            Record a refund
          </button>
        )}
      </div>
      {saved && <p className="mb-3 text-sm text-emerald-400">Refund recorded.</p>}

      {open && (
        <form onSubmit={submit} className="mb-6 grid gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-4 sm:grid-cols-3" aria-label="Record a refund">
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">Amount (Rp)</span>
            <input required type="number" min={1} step={1} value={form.amount} onChange={set("amount")} className={input} aria-label="Refund amount" placeholder="60000" />
          </label>
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">Refunded to</span>
            <input required minLength={2} maxLength={80} value={form.recipientName} onChange={set("recipientName")} className={input} aria-label="Refunded to" placeholder="Name" />
          </label>
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">Date</span>
            <input required type="date" max={today} value={form.date} onChange={set("date")} className={input} aria-label="Refund date" />
          </label>
          <label className="text-sm text-neutral-300 sm:col-span-3">
            <span className="mb-1 block">Reason</span>
            <input required minLength={3} maxLength={200} value={form.reason} onChange={set("reason")} className={input} aria-label="Refund reason" placeholder="No-show, refunded as goodwill" />
          </label>
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">For</span>
            <select value={form.category} onChange={set("category")} className={input} aria-label="Refund for">
              <option value="MEMBERSHIP">Membership</option>
              <option value="CLASS">Class</option>
              <option value="DAY_PASS">Day pass</option>
              <option value="FIELD">Field booking</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">Paid back by</span>
            <select value={form.method} onChange={set("method")} className={input} aria-label="Refund method">
              <option value="CASH">Cash</option>
              <option value="TRANSFER">Bank transfer</option>
            </select>
          </label>
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">Note (optional)</span>
            <input maxLength={300} value={form.note} onChange={set("note")} className={input} aria-label="Refund note" placeholder="Transfer ref, who handled it" />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <button className={primary} disabled={busy}>{busy ? "Saving…" : "Record refund"}</button>
            <button type="button" className={btn} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
            {error && <span className="text-sm text-red-400" role="alert">{error}</span>}
          </div>
        </form>
      )}

      {refunds.length === 0 ? (
        <p className="text-sm text-neutral-500">No refunds recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="pb-2 font-normal">Date</th>
                <th className="pb-2 font-normal">To</th>
                <th className="pb-2 font-normal">For</th>
                <th className="pb-2 font-normal">Reason</th>
                <th className="pb-2 font-normal">Amount</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.id} className="border-t border-neutral-800 align-top" data-testid="refund-row">
                  <td className="py-2 text-neutral-400">{r.date}</td>
                  <td className="py-2">{r.recipientName}</td>
                  <td className="py-2 text-neutral-400">{r.categoryLabel} · {r.methodLabel}</td>
                  <td className="py-2 text-neutral-400">
                    {r.reason}
                    {r.note && <span className="block text-xs text-neutral-500">{r.note}</span>}
                  </td>
                  <td className="py-2 text-red-400">−{rp(r.amount)}</td>
                  <td className="py-2 text-right">
                    <button className={`${btn} hover:border-red-800 hover:text-red-400`} onClick={() => remove(r)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
