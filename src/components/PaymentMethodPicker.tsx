"use client";

import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/paymentMethod";

/**
 * Cash / Transfer / QRIS, for every form where staff record money. `compact` is a small select for a row's action
 * buttons (approving a request); otherwise three buttons under a label.
 */
export default function PaymentMethodPicker({
  value,
  onChange,
  compact = false,
  label = "Paid by",
}: {
  value: PaymentMethod;
  onChange: (m: PaymentMethod) => void;
  compact?: boolean;
  label?: string;
}) {
  if (compact) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PaymentMethod)}
        aria-label={label}
        className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-white"
      >
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>
            {PAYMENT_METHOD_LABEL[m]}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="text-sm text-neutral-300">
      <span className="mb-1 block">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-neutral-700 bg-neutral-950 p-1">
        {PAYMENT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            onClick={() => onChange(m)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${value === m ? "bg-white text-neutral-950" : "text-neutral-400 hover:text-white"}`}
          >
            {PAYMENT_METHOD_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}
