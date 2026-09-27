"use client";

import { useState } from "react";
import TermsConsent from "@/components/TermsConsent";

interface Plan {
  id: string;
  name: string;
  price: number;
  days: number;
}

interface BankInfo {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

const input =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none placeholder:text-neutral-500 focus:border-plate-blue";
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

export default function JoinForm({ slug, plans, bank }: { slug: string; plans: Plan[]; bank: BankInfo | null }) {
  const [planId, setPlanId] = useState(plans[0].id);
  const [v, setV] = useState({ fullName: "", email: "", phone: "", password: "" });
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("planId", planId);
      fd.set("fullName", v.fullName);
      fd.set("email", v.email);
      fd.set("phone", v.phone);
      fd.set("password", v.password);
      fd.set("acceptTerms", String(acceptTerms));
      if (proof) fd.set("proof", proof);

      const res = await fetch(`/api/g/${slug}/join`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.signupId) {
        setError({ field: body.field ?? "form", message: body.error ?? "Something went wrong. Please try again." });
        setBusy(false);
        return;
      }
      window.location.href = `/g/${slug}/join/success?id=${body.signupId}`;
    } catch {
      setError({ field: "form", message: "Network problem. Check your connection and try again." });
      setBusy(false);
    }
  }

  const err = (f: string) => (error?.field === f ? <p className="mt-1 text-sm text-red-400">{error.message}</p> : null);
  const chosen = plans.find((p) => p.id === planId)!;

  return (
    <form onSubmit={submit} className="space-y-8">
      <fieldset>
        <legend className="mb-3 text-sm text-neutral-300">Choose your plan</legend>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
          {plans.map((p) => {
            const on = p.id === planId;
            return (
              <label
                key={p.id}
                className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                  on ? "border-plate-blue bg-neutral-900 shadow-[0_0_0_1px_var(--plate-blue)]" : "border-neutral-800 hover:border-neutral-600"
                }`}
              >
                <input type="radio" name="plan" value={p.id} checked={on} onChange={() => setPlanId(p.id)} className="sr-only" />
                <span className="block font-display text-lg font-semibold">{p.name}</span>
                <span className="mt-1 block text-xl tabular-nums">{rp(p.price)}</span>
                <span className="mt-1 block text-sm text-neutral-400">{p.days} days of access</span>
              </label>
            );
          })}
        </div>
        {err("planId")}
      </fieldset>

      <div className="space-y-5">
        <div>
          <label htmlFor="fullName" className="mb-1 block text-sm text-neutral-300">Full name</label>
          <input id="fullName" required minLength={2} maxLength={80} value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} className={input} autoComplete="name" />
          {err("fullName")}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-neutral-300">Email (you&apos;ll log in with this)</label>
            <input id="email" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} className={input} autoComplete="email" />
            {err("email")}
          </div>
          <div>
            <label htmlFor="phone" className="mb-1 block text-sm text-neutral-300">WhatsApp number</label>
            <input id="phone" required value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} className={input} inputMode="tel" autoComplete="tel" placeholder="0812…" />
            {err("phone")}
          </div>
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm text-neutral-300">Password</label>
          <input id="password" type="password" required minLength={8} maxLength={72} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} className={input} autoComplete="new-password" />
          <p className="mt-1 text-xs text-neutral-500">At least 8 characters.</p>
          {err("password")}
        </div>
      </div>

      <div className="rounded-xl border border-plate-blue/40 bg-neutral-900 p-5">
        <p className="text-sm font-medium text-white">Pay by bank transfer</p>
        {bank ? (
          <div className="mt-3 space-y-1 text-sm">
            <p className="text-neutral-400">
              {bank.bankName} · <span className="tabular-nums text-white">{bank.accountNumber}</span>
            </p>
            <p className="text-neutral-400">a.n. {bank.accountHolder}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-amber-400">This gym hasn&apos;t added bank details yet — ask the front desk how to pay.</p>
        )}
        <p className="mt-3 text-sm text-neutral-400">
          Transfer <span className="tabular-nums text-white">{rp(chosen.price)}</span>, then submit this form. Staff will confirm your
          payment and activate your membership — it isn&apos;t instant.
        </p>
      </div>

      <div>
        <label htmlFor="proof" className="mb-1 block text-sm text-neutral-300">Proof of transfer (optional)</label>
        <input
          id="proof"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setProof(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-neutral-400 file:mr-4 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-neutral-700"
        />
        <p className="mt-1 text-xs text-neutral-500">A screenshot of the transfer speeds up approval. JPEG, PNG or WebP, under 2MB.</p>
        {err("proof")}
      </div>

      <TermsConsent checked={acceptTerms} onChange={setAcceptTerms} error={error?.field === "acceptTerms" ? error.message : null} />

      {error && error.field === "form" && <p className="text-sm text-red-400">{error.message}</p>}

      <div>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-white px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-60 sm:w-auto">
          {busy ? "Sending…" : "Submit request"}
        </button>
        <p className="mt-3 text-xs text-neutral-500">Staff reviews every request before your membership starts.</p>
      </div>
    </form>
  );
}
