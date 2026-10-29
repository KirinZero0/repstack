"use client";

import { useState } from "react";
import ChannelPicker, { type Channel } from "@/components/ChannelPicker";

export default function RemindButton({ slug, memberId }: { slug: string; memberId: string; name?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(channel: Channel) {
    setState("sending");
    setError(null);
    const res = await fetch(`/api/${slug}/members/${memberId}/remind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    if (res.ok) return setState("sent");
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Couldn't send. Try again.");
    setState("idle");
  }

  return (
    <>
      {state === "sent" ? (
        <span className="whitespace-nowrap text-xs text-emerald-400">Reminder sent</span>
      ) : (
        <ChannelPicker label="Send reminder" busy={state === "sending"} onPick={send} />
      )}
      {error && <p className="mt-1 max-w-[16rem] whitespace-normal text-xs text-red-400">{error}</p>}
    </>
  );
}
