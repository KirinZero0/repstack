"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SaasPlanOption {
  id: string;
  name: string;
  price: string;
  billingInterval: string;
}

export default function CreateGymForm({ saasPlans }: { saasPlans: SaasPlanOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    gymName: "",
    slug: "",
    saasPlanId: saasPlans[0]?.id ?? "",
    isLifetime: false,
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    ownerTempPassword: "",
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/gyms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Failed to create gym");
        return;
      }
      setOpen(false);
      setForm({
        gymName: "",
        slug: "",
        saasPlanId: saasPlans[0]?.id ?? "",
        isLifetime: false,
        ownerName: "",
        ownerEmail: "",
        ownerPhone: "",
        ownerTempPassword: "",
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200"
      >
        + New gym tenant
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-6 sm:grid-cols-2"
    >
      <h2 className="col-span-full text-lg font-semibold text-white">New gym tenant</h2>

      <Field label="Gym name">
        <input
          required
          value={form.gymName}
          onChange={(e) => update("gymName", e.target.value)}
          className="input"
        />
      </Field>
      <Field label="Slug">
        <input
          required
          pattern="[a-z0-9-]+"
          value={form.slug}
          onChange={(e) => update("slug", e.target.value)}
          className="input"
        />
      </Field>
      <Field label="SaaS plan">
        <select
          value={form.saasPlanId}
          onChange={(e) => update("saasPlanId", e.target.value)}
          className="input"
        >
          {saasPlans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — Rp {Number(p.price).toLocaleString("id-ID")} / {p.billingInterval}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Lifetime account (skip billing cron)">
        <input
          type="checkbox"
          checked={form.isLifetime}
          onChange={(e) => update("isLifetime", e.target.checked)}
          className="h-5 w-5"
        />
      </Field>
      <Field label="Owner name">
        <input
          required
          value={form.ownerName}
          onChange={(e) => update("ownerName", e.target.value)}
          className="input"
        />
      </Field>
      <Field label="Owner email">
        <input
          type="email"
          required
          value={form.ownerEmail}
          onChange={(e) => update("ownerEmail", e.target.value)}
          className="input"
        />
      </Field>
      <Field label="Owner phone (WhatsApp)">
        <input
          value={form.ownerPhone}
          onChange={(e) => update("ownerPhone", e.target.value)}
          className="input"
        />
      </Field>
      <Field label="Owner temp password">
        <input
          required
          minLength={8}
          value={form.ownerTempPassword}
          onChange={(e) => update("ownerTempPassword", e.target.value)}
          className="input"
        />
      </Field>

      {error && <p className="col-span-full text-sm text-red-400">{error}</p>}

      <div className="col-span-full flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create gym"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>

      <style jsx>{`
        .input {
          background: #0a0a0a;
          border: 1px solid #404040;
          border-radius: 0.375rem;
          padding: 0.5rem 0.75rem;
          color: white;
          width: 100%;
        }
      `}</style>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm text-neutral-300">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
