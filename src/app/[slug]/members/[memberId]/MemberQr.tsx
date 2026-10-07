"use client";

import { useState } from "react";

/** Shows the member's check-in QR to staff on demand, e.g. when the member's phone is dead or they haven't activated yet. */
export default function MemberQr({ slug, memberId }: { slug: string; memberId: string }) {
  const [qr, setQr] = useState<{ name: string; status: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/${slug}/members/${memberId}/qr`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Couldn't load the QR code.");
        return;
      }
      setQr(body);
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!qr) {
    return (
      <div>
        <button
          type="button"
          onClick={show}
          disabled={busy}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? "Loading…" : "Show check-in QR"}
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="rounded-xl bg-[#ffffff] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr.dataUrl} alt={`Check-in QR code for ${qr.name}`} width={240} height={240} />
      </div>
      {qr.status !== "ACTIVE" && (
        <p className="text-xs text-amber-400">This member&apos;s status is {qr.status.replace("_", " ").toLowerCase()}, so a scan will be declined until that changes.</p>
      )}
      <p className="text-xs text-neutral-500">Scan it with the staff scanner. Don&apos;t share or screenshot it: anyone with it can check in as this member.</p>
      <button type="button" onClick={() => setQr(null)} className="text-sm text-neutral-300 underline underline-offset-2 hover:text-white">
        Hide QR
      </button>
    </div>
  );
}
