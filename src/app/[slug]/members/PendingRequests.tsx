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
}

export default function PendingRequests({ slug, requests }: { slug: string; requests: PendingRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (requests.length === 0) return null;

  return (
    <div className="mb-8 overflow-x-auto rounded-xl border border-amber-500/30 bg-neutral-900">
      <div className="px-4 py-3">
        <h2 className="text-lg font-semibold text-white">
          Pending requests <span className="font-normal text-neutral-400">({requests.length})</span>
        </h2>
        <p className="text-sm text-neutral-400">People who submitted a bank-transfer join request. Confirm the payment before approving.</p>
      </div>
      {error && <p className="px-4 pb-2 text-sm text-red-400">{error}</p>}
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-neutral-950 text-neutral-400">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Submitted</th>
            <th className="px-4 py-3">Proof</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className="border-t border-neutral-800">
              <td className="px-4 py-3 font-medium">{r.fullName}</td>
              <td className="px-4 py-3 text-neutral-400">{r.email}</td>
              <td className="px-4 py-3 text-neutral-400">{r.phone}</td>
              <td className="px-4 py-3">{r.plan}</td>
              <td className="px-4 py-3 tabular-nums">Rp {Number(r.amount).toLocaleString("id-ID")}</td>
              <td className="px-4 py-3 text-neutral-400">{new Date(r.createdAt).toLocaleString("id-ID")}</td>
              <td className="px-4 py-3">
                {r.hasProof ? (
                  <a href={`/api/${slug}/join/${r.id}/proof`} target="_blank" rel="noreferrer" className="text-plate-blue underline underline-offset-2">
                    View
                  </a>
                ) : (
                  <span className="text-neutral-600">None</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <button
                    disabled={busyId === r.id}
                    onClick={() => act(r.id, "approve")}
                    className="whitespace-nowrap rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => act(r.id, "reject")}
                    className="whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
