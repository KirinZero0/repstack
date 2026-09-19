"use client";

import { useState } from "react";

export default function PayButton({ planId, label, primary }: { planId: string; label: string; primary?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.invoiceUrl) {
        setError(typeof body.error === "string" ? body.error : "Could not start the payment.");
        setLoading(false);
        return;
      }
      window.location.href = body.invoiceUrl;
    } catch {
      setError("Network problem. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={pay}
        disabled={loading}
        className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
          primary
            ? "bg-white text-neutral-950 hover:bg-neutral-200"
            : "border border-neutral-700 text-white hover:bg-neutral-800"
        }`}
      >
        {loading ? "Opening payment…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
