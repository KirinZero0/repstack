"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PlanOption {
  id: string;
  name: string;
  price: string;
}

export default function AddMemberForm({ slug, plans }: { slug: string; plans: PlanOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phoneWhatsapp: "",
    planId: plans[0]?.id ?? "",
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/g/${slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Failed to add member");
        return;
      }
      setOpen(false);
      setForm({ fullName: "", email: "", phoneWhatsapp: "", planId: plans[0]?.id ?? "" });
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
        + Add member
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-6 sm:grid-cols-2"
    >
      <h2 className="col-span-full text-lg font-semibold text-white">Add member</h2>

      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Full name</span>
        <input
          required
          value={form.fullName}
          onChange={(e) => update("fullName", e.target.value)}
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white"
        />
      </label>
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Email (login)</span>
        <input
          type="email"
          required
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white"
        />
      </label>
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">WhatsApp phone</span>
        <input
          required
          value={form.phoneWhatsapp}
          onChange={(e) => update("phoneWhatsapp", e.target.value)}
          placeholder="081234567890"
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white"
        />
      </label>
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Plan</span>
        <select
          value={form.planId}
          onChange={(e) => update("planId", e.target.value)}
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — Rp {Number(p.price).toLocaleString("id-ID")}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="col-span-full text-sm text-red-400">{error}</p>}

      <div className="col-span-full flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-50"
        >
          {loading ? "Adding…" : "Add member"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
