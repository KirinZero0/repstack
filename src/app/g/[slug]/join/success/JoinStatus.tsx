"use client";

import { useEffect, useState } from "react";

interface Status {
  status: "PENDING" | "COMPLETED" | "CONFLICT";
  gymName: string;
}

export default function JoinStatus({ slug, signupId, mock }: { slug: string; signupId: string; mock: boolean }) {
  const [data, setData] = useState<Status | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    async function poll() {
      const res = await fetch(`/api/g/${slug}/join/${signupId}/status`, { cache: "no-store" }).catch(() => null);
      if (stop) return;
      if (res?.status === 404) return setMissing(true);
      if (res?.ok) {
        const body = (await res.json()) as Status;
        setData(body);
        if (body.status !== "PENDING") return;
      }
      setTimeout(poll, 2500);
    }
    poll();
    return () => {
      stop = true;
    };
  }, [slug, signupId]);

  async function simulatePaid() {
    setBusy(true);
    await fetch("/api/dev/mock-signup-pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signupId }),
    });
    setBusy(false);
  }

  if (missing) {
    return (
      <div>
        <h1 className="text-3xl font-semibold">We couldn&apos;t find that sign-up</h1>
        <p className="mt-3 text-neutral-400">The link may be wrong or has expired. You can start again below.</p>
        <a href={`/g/${slug}/join`} className="mt-6 inline-block rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">Join {slug}</a>
      </div>
    );
  }

  if (data?.status === "COMPLETED") {
    return (
      <div>
        <h1 className="text-3xl font-semibold">Welcome to {data.gymName}</h1>
        <p className="mt-3 max-w-md text-neutral-400">
          Your payment went through and your membership is active. Log in with the email and password you just chose to see your check-in QR code.
        </p>
        <a href={`/g/${slug}/member-login`} className="mt-8 inline-block rounded-lg bg-plate-green px-6 py-3 text-sm font-semibold text-[#ffffff] hover:brightness-110">
          Log in
        </a>
      </div>
    );
  }

  if (data?.status === "CONFLICT") {
    return (
      <div>
        <h1 className="text-3xl font-semibold">Payment received, but we need to check something</h1>
        <p className="mt-3 max-w-md text-neutral-400">
          Your email was registered while your payment was processing, so we couldn&apos;t create your membership automatically. Please tell the front desk. Your payment is safe.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold">Waiting for your payment</h1>
      <p className="mt-3 max-w-md text-neutral-400">
        Once your payment clears, this page updates by itself and your membership starts. You can leave it open.
      </p>
      <div className="mt-6 flex items-center gap-3 text-sm text-neutral-400" role="status">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-plate-yellow" aria-hidden="true" />
        Checking for payment…
      </div>

      {mock && (
        <div className="mt-8 rounded-xl border border-dashed border-plate-yellow p-5">
          <p className="text-sm font-medium">Test checkout (development only)</p>
          <p className="mt-1 text-sm text-neutral-400">In production this is Xendit&apos;s payment page.</p>
          <button onClick={simulatePaid} disabled={busy} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-60">
            {busy ? "Confirming…" : "Simulate successful payment"}
          </button>
        </div>
      )}
    </div>
  );
}
