"use client";

import { useState } from "react";

export type Channel = "whatsapp" | "email";

/**
 * A send button that asks how to send: WhatsApp or email. Nothing is sent until one of the two is clicked,
 * which is what keeps WhatsApp a deliberate, manual action.
 */
export default function ChannelPicker({
  label,
  busy = false,
  busyLabel = "Sending…",
  onPick,
  className = "whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50",
}: {
  label: string;
  busy?: boolean;
  busyLabel?: string;
  onPick: (channel: Channel) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const optionCls =
    "rounded-md border border-neutral-600 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";

  if (!open || busy) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={busy} className={className} aria-haspopup="true">
        {busy ? busyLabel : label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" role="group" aria-label={`${label}: send by`}>
      <span className="text-xs text-neutral-400">Send by</span>
      <button
        type="button"
        className={optionCls}
        onClick={() => {
          setOpen(false);
          onPick("whatsapp");
        }}
      >
        WhatsApp
      </button>
      <button
        type="button"
        className={optionCls}
        onClick={() => {
          setOpen(false);
          onPick("email");
        }}
      >
        Email
      </button>
      <button type="button" className="px-1 text-xs text-neutral-500 hover:text-neutral-300" onClick={() => setOpen(false)} aria-label="Cancel">
        ✕
      </button>
    </span>
  );
}
