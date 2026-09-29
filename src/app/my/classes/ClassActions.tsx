"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BookButton({ sessionId, label }: { sessionId: string; label: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function book() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/my/classes/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not book this class.");
        setLoading(false);
        return;
      }
      if (body.invoiceUrl) {
        window.location.href = body.invoiceUrl;
        return;
      }
      router.refresh();
      setLoading(false);
    } catch {
      setError("Network problem. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="text-right">
      <button
        onClick={book}
        disabled={loading}
        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-60"
      >
        {loading ? "Booking…" : label}
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function CancelBookingButton({ registrationId, paid }: { registrationId: string; paid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    const msg = paid
      ? "Cancel this booking? You've already paid — talk to the front desk about a refund or credit."
      : "Cancel this booking?";
    if (!window.confirm(msg)) return;
    setBusy(true);
    const res = await fetch(`/api/my/classes/${registrationId}/cancel`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      window.alert(typeof b.error === "string" ? b.error : "Could not cancel the booking.");
      return;
    }
    router.refresh();
  }

  return (
    <button onClick={cancel} disabled={busy} className="text-xs text-neutral-400 underline underline-offset-2 hover:text-white disabled:opacity-50">
      {busy ? "Cancelling…" : "Cancel"}
    </button>
  );
}
