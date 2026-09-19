"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Shown only in dev mock mode, in place of the Xendit-hosted page. */
export default function MockCheckout({ paymentId, amount, planName }: { paymentId: string; amount: string; planName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function simulatePaid() {
    setBusy(true);
    await fetch("/api/dev/mock-pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId }),
    });
    router.replace("/my");
    router.refresh();
  }

  return (
    <div className="mb-6 rounded-xl border border-dashed border-plate-yellow p-5">
      <p className="text-sm font-medium text-white">Test checkout (development only)</p>
      <p className="mt-1 text-sm text-neutral-400">
        In production this is Xendit&apos;s payment page. {planName}: {amount}.
      </p>
      <button
        onClick={simulatePaid}
        disabled={busy}
        className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-60"
      >
        {busy ? "Confirming…" : "Simulate successful payment"}
      </button>
    </div>
  );
}
