"use client";

import { useEffect, useState } from "react";

interface Status {
  status: "PENDING_REVIEW" | "COMPLETED" | "REJECTED" | "CONFLICT";
  gymName: string;
}

export default function JoinStatus({ slug, signupId }: { slug: string; signupId: string }) {
  const [data, setData] = useState<Status | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stop = false;
    async function poll() {
      const res = await fetch(`/api/${slug}/join/${signupId}/status`, { cache: "no-store" }).catch(() => null);
      if (stop) return;
      if (res?.status === 404) return setMissing(true);
      if (res?.ok) {
        const body = (await res.json()) as Status;
        setData(body);
        if (body.status !== "PENDING_REVIEW") return;
      }
      setTimeout(poll, 2500);
    }
    poll();
    return () => {
      stop = true;
    };
  }, [slug, signupId]);

  if (missing) {
    return (
      <div>
        <h1 className="text-3xl font-semibold">We couldn&apos;t find that request</h1>
        <p className="mt-3 text-neutral-400">The link may be wrong. You can start again below.</p>
        <a href={`/${slug}/join`} className="mt-6 inline-block rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">Join {slug}</a>
      </div>
    );
  }

  if (data?.status === "COMPLETED") {
    return (
      <div>
        <h1 className="text-3xl font-semibold">Welcome to {data.gymName}</h1>
        <p className="mt-3 max-w-md text-neutral-400">
          Staff confirmed your payment and your membership is active. Log in with the email and password you just chose to see your check-in QR code.
        </p>
        <a href={`/${slug}/login`} className="mt-8 inline-block rounded-lg bg-plate-green px-6 py-3 text-sm font-semibold text-[#ffffff] hover:brightness-110">
          Log in
        </a>
      </div>
    );
  }

  if (data?.status === "REJECTED") {
    return (
      <div>
        <h1 className="text-3xl font-semibold">We couldn&apos;t confirm your payment</h1>
        <p className="mt-3 max-w-md text-neutral-400">
          Staff at {data.gymName} couldn&apos;t verify your transfer. Please check with the front desk, or start again with a
          clearer proof of payment.
        </p>
        <a href={`/${slug}/join`} className="mt-8 inline-block rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">Try again</a>
      </div>
    );
  }

  if (data?.status === "CONFLICT") {
    return (
      <div>
        <h1 className="text-3xl font-semibold">Approved, but we need to check something</h1>
        <p className="mt-3 max-w-md text-neutral-400">
          Your email was registered while your request was pending, so we couldn&apos;t create your membership automatically. Please tell the front desk.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold">Request sent</h1>
      <p className="mt-3 max-w-md text-neutral-400">
        Staff at {data?.gymName ?? "the gym"} will confirm your payment and activate your membership. This page updates by itself — you can leave it open, or close it and check back later.
      </p>
      <div className="mt-6 flex items-center gap-3 text-sm text-neutral-400" role="status">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-plate-yellow" aria-hidden="true" />
        Waiting for staff to review…
      </div>
    </div>
  );
}
