"use client";

import { useState } from "react";

/** Staff creates a one-time password link for a member; shown so it can be handed over in person. */
export default function PasswordLinkButton({ slug, memberId }: { slug: string; memberId: string }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await fetch(`/api/${slug}/members/${memberId}/reset-link`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Could not create a link.");
    setUrl(body.url);
  }

  return (
    <div>
      <button onClick={create} disabled={busy} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50">
        {busy ? "Creating…" : "Send password link"}
      </button>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {url && (
        <div className="mt-3 rounded-lg border border-plate-yellow/60 bg-neutral-950 p-3 text-xs">
          <p className="text-neutral-400">Sent to their WhatsApp if it&apos;s set up. It works once for one hour. Or give them this link:</p>
          <p className="mt-2 break-all text-white">{url}</p>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(url);
              setCopied(true);
            }}
            className="mt-2 text-neutral-300 underline underline-offset-2 hover:text-white"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}
