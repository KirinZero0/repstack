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
  const [link, setLink] = useState<{ url: string; ownerEmail: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  function ownerLink() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const res = await fetch(`/api/superadmin/gyms/${gymId}/owner-reset`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not create a link");
        return;
      }
      setLink({ url: body.url, ownerEmail: body.ownerEmail });
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={ownerLink}
          disabled={isPending}
          className="whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          Owner password link
        </button>
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
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
      {link && (
        <div className="max-w-xs rounded-md border border-neutral-700 bg-neutral-950 p-2 text-left text-xs">
          <p className="text-neutral-400">One-time link for {link.ownerEmail} (1 hour):</p>
          <p className="mt-1 break-all text-white">{link.url}</p>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(link.url);
              setCopied(true);
            }}
            className="mt-1 text-neutral-300 underline underline-offset-2"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
