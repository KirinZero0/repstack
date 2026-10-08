"use client";

import { useState } from "react";
import TransferPayment, { type BankInfo, rupiah } from "@/components/TransferPayment";

export interface SessionOption {
  id: string;
  label: string;
  className: string;
  instructor: string | null;
  price: number;
}

const input =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none placeholder:text-neutral-500 focus:border-plate-blue";

export default function GuestPassForm({ slug, sessions, bank }: { slug: string; sessions: SessionOption[]; bank: BankInfo | null }) {
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const price = sessions.find((s) => s.id === sessionId)?.price ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("sessionId", sessionId);
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
          The gym will review it (and check your payment, if the class isn't free). Your one-time QR ticket then arrives on WhatsApp — show it at the front desk.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset>
          <legend className="mb-2 text-sm font-medium text-neutral-300">Class</legend>
          <div className="space-y-2">
            {sessions.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 has-[:checked]:border-plate-blue">
                <input type="radio" name="sessionId" value={s.id} checked={sessionId === s.id} onChange={() => setSessionId(s.id)} />
                <span>
                  <span className="block font-medium">{s.className}{s.instructor ? ` · ${s.instructor}` : ""}</span>
                  <span className="block text-sm text-neutral-400">{s.label} · {s.price > 0 ? rupiah(s.price) : "Free"}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
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
        {busy ? "Sending…" : "Request a spot"}
      </button>
    </form>
  );
}
