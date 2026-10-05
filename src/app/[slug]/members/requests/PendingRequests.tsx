"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PendingRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  plan: string;
  amount: string;
  createdAt: string;
  hasProof: boolean;
  kind: "JOIN" | "RENEWAL";
}

export default function PendingRequests({ slug, requests }: { slug: string; requests: PendingRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomedId, setZoomedId] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/${slug}/join/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Failed to update request");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {requests.map((r) => (
        <div key={r.id} className="rounded-xl border border-amber-500/30 bg-neutral-900 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-4">
              {r.hasProof && (
                <button
                  onClick={() => setZoomedId(r.id)}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/${slug}/join/${r.id}/proof`} alt="Transfer proof" className="h-full w-full object-cover" />
                </button>
              )}
              <div>
                <p className="font-medium">
                  {r.fullName}
                  <span className={`ml-2 rounded-full border px-2 py-0.5 text-xs font-normal ${r.kind === "RENEWAL" ? "border-blue-800 bg-blue-950 text-blue-300" : "border-neutral-700 text-neutral-400"}`}>
                    {r.kind === "RENEWAL" ? "Renewal · existing member" : "New member"}
                  </span>
                </p>
                <p className="text-sm text-neutral-400">{r.plan} · Rp {Number(r.amount).toLocaleString("id-ID")}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {r.email} · {r.phone}
                </p>
                <p className="text-xs text-neutral-600">Submitted {new Date(r.createdAt).toLocaleString("id-ID")}</p>
                {!r.hasProof && <p className="mt-1 text-xs text-amber-400">No proof image attached</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busyId === r.id}
                onClick={() => act(r.id, "approve")}
                className="whitespace-nowrap rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={busyId === r.id}
                onClick={() => act(r.id, "reject")}
                className="whitespace-nowrap rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ))}

      {zoomedId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setZoomedId(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/${slug}/join/${zoomedId}/proof`}
            alt="Transfer proof, full size"
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
