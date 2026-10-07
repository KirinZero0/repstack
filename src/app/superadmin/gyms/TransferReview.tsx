"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface TransferInfo {
  amount: number;
  hasProof: boolean;
  senderName: string | null;
  transferDate: string | null;
  reference: string;
  submittedAt: string | null;
}

const btn = "rounded-md border px-3 py-1 text-sm disabled:opacity-50";

/**
 * Reviews a gym's bank transfer: shows the owner's proof, what to look for in the bank statement, and
 * lets the superadmin confirm or reject. Confirming needs proof; without it there's an explicit override.
 */
export default function TransferReview({ gymId, transfer }: { gymId: string; transfer: TransferInfo }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "confirm" | "reject">("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rp = `Rp ${transfer.amount.toLocaleString("id-ID")}`;

  async function call(action: "payment-paid" | "payment-reject", body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/superadmin/gyms/${gymId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Action failed");
        return;
      }
      setMode("idle");
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-72 space-y-2 rounded-md border border-sky-800 bg-sky-950 p-3 text-left text-xs text-sky-100">
      <p className="font-medium text-sky-300">Bank transfer · {rp}</p>
      <p className="text-sky-400">
        Look for <span className="font-mono text-sky-200">{transfer.reference}</span> in your bank statement.
      </p>

      {transfer.hasProof ? (
        <>
          <p>
            From <span className="text-white">{transfer.senderName ?? "—"}</span>
            {transfer.transferDate ? <> on {transfer.transferDate}</> : null}
          </p>
          <a href={`/api/superadmin/gyms/${gymId}/payment-proof`} target="_blank" rel="noreferrer" className="inline-block text-sky-300 underline underline-offset-2">
            View proof screenshot ↗
          </a>
        </>
      ) : (
        <p className="text-amber-300">No proof sent yet.</p>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={() => setMode("confirm")} className={`${btn} border-sky-500 text-sky-200 hover:bg-sky-900`}>
            {transfer.hasProof ? "Confirm paid" : "Confirm without proof"}
          </button>
          {transfer.hasProof && (
            <button onClick={() => setMode("reject")} className={`${btn} border-red-800 text-red-300 hover:bg-red-950`}>
              Reject
            </button>
          )}
        </div>
      )}

      {mode === "confirm" && (
        <div className="space-y-2 pt-1">
          <p>{transfer.hasProof ? `Is ${rp} in the bank account?` : `There's no proof. Only continue if you saw ${rp} arrive in the bank account.`}</p>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => call("payment-paid", { withoutProof: !transfer.hasProof })} className={`${btn} border-sky-400 bg-sky-500 text-neutral-950 hover:bg-sky-400`}>
              {busy ? "Saving…" : "Yes, mark paid"}
            </button>
            <button onClick={() => setMode("idle")} className="text-sky-300 underline underline-offset-2">Cancel</button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-2 pt-1">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason shown to the owner" className="w-full rounded-md border border-sky-800 bg-neutral-950 px-2 py-1 text-sm text-white" />
          <div className="flex gap-2">
            <button disabled={busy || reason.trim().length < 3} onClick={() => call("payment-reject", { reason })} className={`${btn} border-red-700 bg-red-900 text-white hover:bg-red-800`}>
              {busy ? "Saving…" : "Reject proof"}
            </button>
            <button onClick={() => setMode("idle")} className="text-sky-300 underline underline-offset-2">Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="text-red-300">{error}</p>}
    </div>
  );
}
