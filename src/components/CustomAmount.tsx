"use client";

/**
 * "Custom amount" for a special price: unticked, the normal price is charged; ticked, an amount box appears, filled
 * with the normal price for staff to change. The parent keeps `amount` ("" when unticked) and sends it only when ticked.
 */
export default function CustomAmount({
  normal,
  amount,
  onChange,
}: {
  /** The usual price, in rupiah, or null while it can't be worked out yet (no times picked). */
  normal: number | null;
  amount: string;
  onChange: (amount: string) => void;
}) {
  const on = amount !== "";
  return (
    <div className="text-sm text-neutral-300">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? String(normal ?? 0) : "")}
          className="h-4 w-4 accent-[var(--plate-yellow)]"
          aria-label="Custom amount"
        />
        <span>Custom amount (special price)</span>
      </label>
      {on ? (
        <div className="mt-2">
          <input
            type="number"
            min={0}
            step={1000}
            value={amount}
            onChange={(e) => onChange(e.target.value === "" ? "0" : e.target.value)}
            className="w-full max-w-xs rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white"
            aria-label="Amount paid"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            {normal !== null ? `Normal price Rp ${normal.toLocaleString("id-ID")}. ` : ""}0 means free: nothing is recorded as paid.
          </span>
        </div>
      ) : (
        normal !== null && <span className="mt-1 block text-xs text-neutral-500">Charged at the normal price, Rp {normal.toLocaleString("id-ID")}.</span>
      )}
    </div>
  );
}
