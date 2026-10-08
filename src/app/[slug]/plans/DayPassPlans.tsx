"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface DayPassPlanRow {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
}

const input = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-plate-blue";
const btn = "rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900 disabled:opacity-50";
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Owner-only: the one-visit tickets a gym sells to non-members. Staff just see the requests. */
export default function DayPassPlans({ slug, plans }: { slug: string; plans: DayPassPlanRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: "POST" | "PATCH", body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong.");
    router.refresh();
    return true;
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5" data-testid="day-pass-plans">
      <h2 className="text-lg font-semibold">Day passes</h2>
      <p className="mb-4 text-sm text-neutral-400">
        For visitors who just want to try the gym. They request it from your join page, you approve, and they get a one-time QR ticket. Guests pay at the desk and are never added as members.
      </p>
      {plans.length > 0 && (
        <ul className="mb-4 divide-y divide-neutral-800">
          {plans.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span className={p.isActive ? "" : "text-neutral-500"}>{p.name} · {rp(p.price)}{p.isActive ? "" : " (hidden)"}</span>
              <button className={btn} disabled={busy} onClick={() => call(`/api/${slug}/day-pass-plans/${p.id}`, "PATCH", { isActive: !p.isActive })}>
                {p.isActive ? "Hide" : "Show"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call(`/api/${slug}/day-pass-plans`, "POST", { name, price: Number(price) })) {
            setName("");
            setPrice("");
          }
        }}
      >
        <input required minLength={2} maxLength={60} placeholder="Name, e.g. Single visit" value={name} onChange={(e) => setName(e.target.value)} className={input} aria-label="Day pass name" />
        <input required type="number" min={0} step={1000} placeholder="Price (Rp)" value={price} onChange={(e) => setPrice(e.target.value)} className={input} aria-label="Day pass price" />
        <button disabled={busy} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">Add day pass</button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400" role="alert">{error}</p>}
    </section>
  );
}
