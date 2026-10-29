"use client";

import { useState } from "react";
import ChannelPicker, { type Channel } from "@/components/ChannelPicker";

export default function ResendFallbackButton({ slug, memberId }: { slug: string; memberId: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(channel: Channel) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/${slug}/members/${memberId}/resend-fallback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    setBusy(false);
    setSent(res.ok);
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't send. Try again.");
  }

  return (
    <>
      {sent ? <span className="whitespace-nowrap text-xs text-emerald-400">Sent</span> : <ChannelPicker label="Resend QR link" busy={busy} onPick={send} />}
      {error && <p className="mt-1 max-w-[16rem] whitespace-normal text-xs text-red-400">{error}</p>}
    </>
  );
}
