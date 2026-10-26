"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { discountText, invoiceTotals, type InvoiceDiscount } from "@/lib/invoiceMath";

interface Line {
  description: string;
  quantity: string;
  unitPrice: string;
}

const input = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-neutral-500";
const ghost = "whitespace-nowrap rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800";
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export default function InvoiceForm({ gyms, plans }: { gyms: string[]; plans: { name: string; price: number }[] }) {
  const router = useRouter();
  const [gymName, setGymName] = useState("");
  const [billToName, setBillToName] = useState("");
  const [billToInfo, setBillToInfo] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(inDays(7));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", unitPrice: "" }]);
  const [discountType, setDiscountType] = useState<"NONE" | "PERCENT" | "AMOUNT">("NONE");
  const [discountValue, setDiscountValue] = useState("");
  const [discountLabel, setDiscountLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The server recomputes all of this from the items; this is only the preview, using the same maths.
  const discount: InvoiceDiscount | undefined =
    discountType !== "NONE" && Number(discountValue) > 0 ? { type: discountType, value: Number(discountValue), label: discountLabel } : undefined;
  const { subtotal, discountAmount: off, total } = invoiceTotals(
    lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 })),
    discount,
  );
  const tooMuch = discountType === "AMOUNT" && Number(discountValue) > subtotal;

  function addLine(description: string, unitPrice: number) {
    // Replace the empty starter row instead of leaving it dangling above the preset.
    setLines((ls) => {
      const kept = ls.filter((l) => l.description.trim() || l.unitPrice);
      return [...kept, { description, quantity: "1", unitPrice: String(unitPrice) }];
    });
  }
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/superadmin/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gymName,
        billToName,
        billToInfo,
        issueDate,
        dueDate: dueDate || undefined,
        notes,
        discount: discount ? { type: discount.type, value: discount.value, label: discount.label } : undefined,
        items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice || 0) })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    setSaving(false);
    if (!res.ok || !data.id) return setError(data.error ?? "Couldn't create the invoice.");
    router.push(`/superadmin/invoices/${data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-neutral-300">
          <span className="mb-1 block">Gym name</span>
          <input required minLength={2} maxLength={120} list="invoice-gyms" value={gymName} onChange={(e) => setGymName(e.target.value)} className={input} placeholder="Type any gym name" />
          <datalist id="invoice-gyms">
            {gyms.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
        <label className="text-sm text-neutral-300">
          <span className="mb-1 block">Billed to</span>
          <input required minLength={2} maxLength={120} value={billToName} onChange={(e) => setBillToName(e.target.value)} className={input} placeholder="Name of the person you are billing" />
        </label>
        <label className="text-sm text-neutral-300">
          <span className="mb-1 block">Address / contact (optional)</span>
          <textarea maxLength={500} rows={2} value={billToInfo} onChange={(e) => setBillToInfo(e.target.value)} className={input} />
        </label>
        <label className="text-sm text-neutral-300">
          <span className="mb-1 block">Issue date</span>
          <input required type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={input} />
        </label>
        <label className="text-sm text-neutral-300">
          <span className="mb-1 block">Due date (optional)</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} />
        </label>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-300">Items</span>
          <span className="text-xs text-neutral-500">Quick add:</span>
          <button type="button" className={ghost} onClick={() => addLine("Setup fee", 1_000_000)}>Setup fee</button>
          <button type="button" className={ghost} onClick={() => addLine("Training (included)", 0)}>Training (free)</button>
          {plans.map((p) => (
            <button key={p.name} type="button" className={ghost} onClick={() => addLine(p.name, p.price)}>
              {p.name}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_4.5rem_8rem_auto] items-start gap-2">
              <input required maxLength={200} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={input} placeholder="Description" aria-label="Description" />
              <input required type="number" min={1} max={10000} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className={input} aria-label="Quantity" />
              <input required type="number" min={0} step={1000} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} className={input} placeholder="Price (Rp)" aria-label="Unit price" />
              <button type="button" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className={`${ghost} py-2 disabled:opacity-30`} aria-label="Remove item">
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button type="button" className={ghost} onClick={() => setLines((ls) => [...ls, { description: "", quantity: "1", unitPrice: "" }])}>
            + Add item
          </button>
          {off === 0 && (
            <p className="text-sm">
              Total: <span className="text-lg font-semibold">{rp(total)}</span>
            </p>
          )}
        </div>

        <div className="mt-5 rounded-lg border border-neutral-800 p-3" data-testid="discount-section">
          <p className="mb-2 text-sm text-neutral-300">Discount (optional)</p>
          <div className="grid gap-2 sm:grid-cols-[9rem_8rem_1fr]">
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)} className={input} aria-label="Discount type">
              <option value="NONE">No discount</option>
              <option value="PERCENT">Percent (%)</option>
              <option value="AMOUNT">Fixed amount (Rp)</option>
            </select>
            <input
              type="number"
              min={discountType === "PERCENT" ? 0.01 : 1}
              max={discountType === "PERCENT" ? 100 : undefined}
              step={discountType === "PERCENT" ? "any" : 1}
              disabled={discountType === "NONE"}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              className={`${input} disabled:opacity-40`}
              placeholder={discountType === "PERCENT" ? "e.g. 10" : "e.g. 50000"}
              aria-label="Discount value"
            />
            <input
              maxLength={80}
              disabled={discountType === "NONE"}
              value={discountLabel}
              onChange={(e) => setDiscountLabel(e.target.value)}
              className={`${input} disabled:opacity-40`}
              placeholder="Reason shown on the invoice (optional), e.g. Early bird"
              aria-label="Discount label"
            />
          </div>
          {tooMuch && <p className="mt-2 text-xs text-red-400">The discount can&apos;t be more than the subtotal ({rp(subtotal)}).</p>}
        </div>

        {off > 0 && (
          <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm" data-testid="invoice-preview">
            <div className="flex justify-between text-neutral-400">
              <dt>Subtotal</dt>
              <dd>{rp(subtotal)}</dd>
            </div>
            <div className="flex justify-between text-emerald-400">
              <dt>Discount ({discountLabel.trim() ? `${discountLabel.trim()}, ` : ""}{discountText(discount!.type, discount!.value)})</dt>
              <dd>− {rp(off)}</dd>
            </div>
            <div className="flex justify-between border-t border-neutral-700 pt-1">
              <dt>Total</dt>
              <dd className="text-lg font-semibold">{rp(total)}</dd>
            </div>
          </dl>
        )}
      </div>

      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Notes (optional, printed on the invoice)</span>
        <textarea maxLength={1000} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={saving} className="rounded-lg bg-white px-5 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
        {saving ? "Creating…" : "Create invoice"}
      </button>
    </form>
  );
}
