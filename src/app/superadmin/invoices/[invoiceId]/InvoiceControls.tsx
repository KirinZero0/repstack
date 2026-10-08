"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const btn = "rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";

export default function InvoiceControls({ invoiceId, status }: { invoiceId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "paid" | "unpaid" | "void") {
    if (action === "void" && !window.confirm("Void this invoice? It stays on record but can't be used again.")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/superadmin/invoices/${invoiceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-sm text-red-400">{error}</span>}
      {status === "UNPAID" && <button className={btn} disabled={busy} onClick={() => act("paid")}>Mark paid</button>}
      {status === "PAID" && <button className={btn} disabled={busy} onClick={() => act("unpaid")}>Mark unpaid</button>}
      {status !== "VOID" && <button className={`${btn} hover:border-red-800 hover:text-red-400`} disabled={busy} onClick={() => act("void")}>Void</button>}
      <button className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200" onClick={() => window.print()}>
        Print / save as PDF
      </button>
    </div>
  );
}
