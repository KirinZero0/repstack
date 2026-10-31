"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The superadmin's switch that marks this gym as a test gym. */
export default function TestGymForm({ gymId, initial }: { gymId: string; initial: boolean }) {
  const router = useRouter();
  const [isTest, setIsTest] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    // Shown at once; put back if the server says no.
    setIsTest(next);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/superadmin/gyms/${gymId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isTest: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setIsTest(!next);
      const b = await res.json().catch(() => ({}));
      return setError(typeof b.error === "string" ? b.error : "Couldn't change it.");
    }
    router.refresh();
  }

  return (
    <div>
      <label className="flex items-start gap-3 text-sm text-neutral-300">
        <input type="checkbox" checked={isTest} disabled={busy} onChange={(e) => toggle(e.target.checked)} className="mt-0.5 h-4 w-4" aria-label="Test gym" />
        <span>
          This is a test gym <span className={isTest ? "text-amber-400" : "text-neutral-500"}>({isTest ? "test" : "real"})</span>
          <span className="mt-1 block text-neutral-500">
            Left out of MRR, revenue, gym and member totals on the superadmin pages. Never billed or suspended. Sends nothing on its own
            (welcome, receipts, reminders, &ldquo;request received&rdquo;); send buttons and approve or decline still work. The gym&apos;s own dashboard and finance work as normal.
          </span>
        </span>
      </label>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
