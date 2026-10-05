"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PlanRow {
  id: string;
  name: string;
  durationDays: number;
  price: number;
  isActive: boolean;
  memberCount: number;
}

const inputCls =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-plate-blue";
const btnCls = "rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50";
const ghostCls = "rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800";
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

function PlanForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { name: string; durationDays: number; price: number };
  submitLabel: string;
  onSubmit: (v: { name: string; durationDays: number; price: number }) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [days, setDays] = useState(String(initial.durationDays));
  const [price, setPrice] = useState(String(initial.price));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const err = await onSubmit({ name, durationDays: Number(days), price: Number(price) });
        setSaving(false);
        if (err) setError(err);
      }}
      className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]"
    >
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Plan name</span>
        <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Monthly" />
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Length (days)</span>
        <input required type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className={inputCls} />
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Price (Rp)</span>
        <input required type="number" min={1000} step={1000} value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
      </label>
      <div className="flex items-end gap-2">
        <button type="submit" disabled={saving} className={btnCls}>
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={ghostCls}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="col-span-full text-sm text-red-400">{error}</p>}
    </form>
  );
}

export default function PlansManager({ slug, plans }: { slug: string; plans: PlanRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(plans.length === 0);

  const [rowError, setRowError] = useState<string | null>(null);

  async function call(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<string | null> {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return typeof b.error === "string" ? b.error : "Could not save the plan. Check the values and try again.";
    }
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        {creating ? (
          <>
            <h2 className="mb-4 text-sm font-medium text-neutral-300">New membership plan</h2>
            <PlanForm
              initial={{ name: "", durationDays: 30, price: 250000 }}
              submitLabel="Create plan"
              onSubmit={async (v) => {
                const err = await call(`/api/${slug}/plans`, "POST", v);
                if (!err) setCreating(false);
                return err;
              }}
              onCancel={plans.length > 0 ? () => setCreating(false) : undefined}
            />
          </>
        ) : (
          <button onClick={() => setCreating(true)} className={btnCls}>
            + New plan
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-3 font-normal">Plan</th>
              <th className="px-4 py-3 font-normal">Length</th>
              <th className="px-4 py-3 font-normal">Price</th>
              <th className="px-4 py-3 font-normal">Members</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) =>
              editing === p.id ? (
                <tr key={p.id} className="border-t border-neutral-800">
                  <td colSpan={6} className="px-4 py-4">
                    <PlanForm
                      initial={p}
                      submitLabel="Save changes"
                      onSubmit={async (v) => {
                        const err = await call(`/api/${slug}/plans/${p.id}`, "PATCH", v);
                        if (!err) setEditing(null);
                        return err;
                      }}
                      onCancel={() => setEditing(null)}
                    />
                    <p className="mt-2 text-xs text-neutral-500">Price changes apply to new invoices only.</p>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="border-t border-neutral-800">
                  <td className="px-4 py-3 font-medium text-white">{p.name}</td>
                  <td className="px-4 py-3 text-neutral-400">{p.durationDays} days</td>
                  <td className="px-4 py-3">{rp(p.price)}</td>
                  <td className="px-4 py-3 text-neutral-400">{p.memberCount}</td>
                  <td className="px-4 py-3">
                    <span className={p.isActive ? "text-emerald-400" : "text-neutral-500"}>{p.isActive ? "On sale" : "Hidden"}</span>
                  </td>
                  <td className="flex justify-end gap-2 px-4 py-3">
                    <button onClick={() => setEditing(p.id)} className={ghostCls}>
                      Edit
                    </button>
                    <button onClick={() => call(`/api/${slug}/plans/${p.id}`, "PATCH", { isActive: !p.isActive })} className={ghostCls}>
                      {p.isActive ? "Hide" : "Put on sale"}
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Delete "${p.name}"? This only works for a plan nobody has used.`)) return;
                        setRowError(null);
                        setRowError(await call(`/api/${slug}/plans/${p.id}`, "DELETE"));
                      }}
                      className={`${ghostCls} hover:border-red-800 hover:text-red-400`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ),
            )}
            {plans.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                  No plans yet. Create your first one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rowError && <p className="text-sm text-red-400">{rowError}</p>}
      <p className="text-xs text-neutral-500">
        Hidden plans stay on existing members but can&apos;t be chosen for new members or renewals. A plan can only be deleted while nobody has used it.
      </p>
    </div>
  );
}
