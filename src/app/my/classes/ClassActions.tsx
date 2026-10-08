"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { rupiah, type BankInfo } from "@/components/TransferPayment";

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

/** An unpaid booking: shows where to transfer, and lets the member attach their screenshot for the front desk. */
export function TransferProofForm({ registrationId, amount, bank, hasProof }: { registrationId: string; amount: number; bank: BankInfo | null; hasProof: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bank) return null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a screenshot first.");
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("proof", file);
    const res = await fetch(`/api/my/classes/${registrationId}/proof`, { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(typeof body.error === "string" ? body.error : "Could not send the screenshot.");
    setFile(null);
    router.refresh();
  }

  return (
    <form onSubmit={send} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300" data-testid="class-transfer">
      <p>
        Pay {rupiah(amount)} by transfer to <strong>{bank.bankName}</strong> <span className="font-mono">{bank.accountNumber}</span>
        {bank.accountHolder ? ` (${bank.accountHolder})` : ""}, then send your screenshot. The front desk confirms it.
      </p>
      {hasProof && <p className="mt-1 text-emerald-400">Screenshot sent. Waiting for the gym to confirm.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs text-neutral-400" />
        <button disabled={busy} className="rounded-md border border-neutral-700 px-3 py-1 text-white hover:bg-neutral-800 disabled:opacity-50">
          {busy ? "Sending…" : hasProof ? "Send a new screenshot" : "Send screenshot"}
        </button>
      </div>
      {error && <p className="mt-1 text-red-400" role="alert">{error}</p>}
    </form>
  );
}
