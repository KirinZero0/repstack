"use client";

import { useState, useTransition } from "react";

export default function ResendFallbackButton({ slug, memberId }: { slug: string; memberId: string }) {
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  function handleClick() {
    startTransition(async () => {
      const res = await fetch(`/api/g/${slug}/members/${memberId}/resend-fallback`, {
        method: "POST",
      });
      setSent(res.ok);
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
    >
      {sent ? "Sent" : "Resend QR link"}
    </button>
  );
}
