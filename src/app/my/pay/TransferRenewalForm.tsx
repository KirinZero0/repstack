"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Plan {
  id: string;
  name: string;
  price: number;
  days: number;
  current: boolean;
}

interface Bank {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/**
 * The member transfers to the gym's own bank account, then files the request here with a photo
 * of the transfer. Staff confirm it from their pending-requests queue, which extends the membership.
 */
export default function TransferRenewalForm({ plans, bank }: { plans: Plan[]; bank: Bank }) {
  const router = useRouter();
  const [planId, setPlanId] = useState(plans.find((p) => p.current)?.id ?? plans[0]?.id ?? "");
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = plans.find((p) => p.id === planId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("planId", planId);
      if (proof) fd.set("proof", proof);
      const res = await fetch("/api/my/renewal", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network problem. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <h2 className="font-display text-xl font-semibold">Renew by bank transfer</h2>
      <p className="mt-1 text-sm text-neutral-400">Transfer the plan price to the gym&apos;s account, then send the request below. The gym confirms it and your membership extends.</p>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm text-neutral-300">Plan</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {plans.map((p) => (
            <label
              key={p.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm ${planId === p.id ? "border-white bg-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}
            >
              <input type="radio" name="plan" value={p.id} checked={planId === p.id} onChange={() => setPlanId(p.id)} className="mt-1" />
              <span>
                <span className="font-medium">{p.name}</span>
                {p.current && <span className="ml-2 text-xs text-neutral-500">your plan</span>}
                <span className="block text-neutral-400">
                  {rp(p.price)} · {p.days} days
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-sm">
        <p className="text-neutral-400">Transfer {chosen ? <strong className="text-white">{rp(chosen.price)}</strong> : "the plan price"} to</p>
        <p className="mt-2 font-medium text-white">{bank.bankName}</p>
        <p className="font-mono text-lg tracking-wide text-white">{bank.accountNumber}</p>
        <p className="text-neutral-300">{bank.accountHolder}</p>
      </div>

      <label className="mt-5 block text-sm text-neutral-300">
        <span className="mb-1 block">Proof of transfer (optional, a screenshot helps the gym confirm faster)</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setProof(e.target.files?.[0] ?? null)}
          className="w-full text-sm text-neutral-300 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-neutral-700"
        />
      </label>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy || !planId}
        className="mt-5 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-60"
      >
        {busy ? "Sending…" : "I've transferred, send my request"}
      </button>
    </form>
  );
}
