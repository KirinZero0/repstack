"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function GymActions({
  gymId,
  status,
}: {
  gymId: string;
  status: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function callAction(action: "suspend" | "reactivate") {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/superadmin/gyms/${gymId}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Action failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {status === "SUSPENDED" ? (
        <button
          onClick={() => callAction("reactivate")}
          disabled={isPending}
          className="rounded-md border border-emerald-700 px-3 py-1 text-sm text-emerald-400 hover:bg-emerald-950 disabled:opacity-50"
        >
          Reactivate
        </button>
      ) : (
        <button
          onClick={() => callAction("suspend")}
          disabled={isPending}
          className="rounded-md border border-red-800 px-3 py-1 text-sm text-red-400 hover:bg-red-950 disabled:opacity-50"
        >
          Suspend
        </button>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
