"use client";

import { useState } from "react";

export default function RemindButton({ slug, memberId, name }: { slug: string; memberId: string; name: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm(`Send ${name} a membership reminder?`)) return;
    setState("sending");
    setError(null);
    const res = await fetch(`/api/${slug}/members/${memberId}/remind`, { method: "POST" });
    if (res.ok) return setState("sent");
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Couldn't send. Try again.");
    setState("idle");
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={state === "sending"}
        className="whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : state === "sent" ? "Reminder sent" : "Send reminder"}
      </button>
      {error && <p className="mt-1 max-w-[16rem] whitespace-normal text-xs text-red-400">{error}</p>}
    </>
  );
}
