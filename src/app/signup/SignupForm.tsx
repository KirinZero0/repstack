"use client";

import { useState } from "react";

const input =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none placeholder:text-neutral-500 focus:border-plate-blue";

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function SignupForm({ planId }: { planId: string }) {
  const [v, setV] = useState({ gymName: "", slug: "", ownerName: "", ownerEmail: "", ownerPhone: "", password: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof v>(k: K, value: string) {
    setV((prev) => ({ ...prev, [k]: value, ...(k === "gymName" && !slugTouched ? { slug: slugify(value) } : {}) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saasPlanId: planId, ...v }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.invoiceUrl) {
        setError({ field: body.field ?? "form", message: body.error ?? "Something went wrong. Please try again." });
        setBusy(false);
        return;
      }
      window.location.href = body.invoiceUrl;
    } catch {
      setError({ field: "form", message: "Network problem. Check your connection and try again." });
      setBusy(false);
    }
  }

  const err = (f: string) => (error?.field === f ? <p className="mt-1 text-sm text-red-400">{error.message}</p> : null);

  return (
    <form onSubmit={submit} className="space-y-5" noValidate={false}>
      <div>
        <label htmlFor="gymName" className="mb-1 block text-sm text-neutral-300">Gym name</label>
        <input id="gymName" required minLength={2} maxLength={80} value={v.gymName} onChange={(e) => set("gymName", e.target.value)} className={input} placeholder="Baja Fitness" />
        {err("gymName")}
      </div>

      <div>
        <label htmlFor="slug" className="mb-1 block text-sm text-neutral-300">Your gym&apos;s web address</label>
        <div className="flex items-stretch overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 focus-within:border-plate-blue">
          <span className="flex items-center border-r border-neutral-800 px-3 text-sm text-neutral-500">/g/</span>
          <input
            id="slug"
            required
            minLength={3}
            maxLength={40}
            pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
            value={v.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", e.target.value.toLowerCase());
            }}
            className="w-full bg-transparent px-3 py-2.5 text-white outline-none placeholder:text-neutral-500"
            placeholder="baja-fitness"
          />
        </div>
        <p className="mt-1 text-xs text-neutral-500">Staff and members log in here. Letters, numbers and hyphens only.</p>
        {err("slug")}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="ownerName" className="mb-1 block text-sm text-neutral-300">Your name</label>
          <input id="ownerName" required minLength={2} maxLength={80} value={v.ownerName} onChange={(e) => set("ownerName", e.target.value)} className={input} autoComplete="name" />
          {err("ownerName")}
        </div>
        <div>
          <label htmlFor="ownerPhone" className="mb-1 block text-sm text-neutral-300">WhatsApp number</label>
          <input id="ownerPhone" required value={v.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} className={input} inputMode="tel" autoComplete="tel" placeholder="0812…" />
          <p className="mt-1 text-xs text-neutral-500">Used to send you a link if you forget your password.</p>
          {err("ownerPhone")}
        </div>
      </div>

      <div>
        <label htmlFor="ownerEmail" className="mb-1 block text-sm text-neutral-300">Email (you&apos;ll log in with this)</label>
        <input id="ownerEmail" type="email" required value={v.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} className={input} autoComplete="email" />
        {err("ownerEmail")}
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm text-neutral-300">Password</label>
        <input id="password" type="password" required minLength={8} maxLength={72} value={v.password} onChange={(e) => set("password", e.target.value)} className={input} autoComplete="new-password" />
        <p className="mt-1 text-xs text-neutral-500">At least 8 characters.</p>
        {err("password")}
      </div>

      {error && (error.field === "form" || error.field === "saasPlanId") && <p className="text-sm text-red-400">{error.message}</p>}

      <button type="submit" disabled={busy} className="w-full rounded-lg bg-white px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-60 sm:w-auto">
        {busy ? "Opening payment…" : "Continue to payment"}
      </button>
    </form>
  );
}
