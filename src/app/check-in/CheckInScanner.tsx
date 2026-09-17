"use client";

import { useEffect, useRef, useState } from "react";

type ResultCode =
  | "SUCCESS"
  | "DUPLICATE"
  | "EXPIRED"
  | "FROZEN"
  | "INVALID"
  | "GYM_SUSPENDED"
  | "UNAUTHENTICATED"
  | "MALFORMED";

interface ScanOutcome {
  result: ResultCode;
  member?: { fullName: string; photoUrl: string | null };
}

const OVERLAY_STYLE: Record<ResultCode, { bg: string; label: string }> = {
  SUCCESS: { bg: "bg-emerald-600", label: "CHECKED IN" },
  DUPLICATE: { bg: "bg-amber-600", label: "ALREADY CHECKED IN TODAY" },
  EXPIRED: { bg: "bg-red-600", label: "MEMBERSHIP EXPIRED" },
  FROZEN: { bg: "bg-red-600", label: "MEMBERSHIP FROZEN" },
  INVALID: { bg: "bg-red-600", label: "NOT A VALID CHECK-IN CODE" },
  GYM_SUSPENDED: { bg: "bg-red-600", label: "GYM ACCOUNT SUSPENDED" },
  UNAUTHENTICATED: { bg: "bg-red-600", label: "SESSION EXPIRED — LOG IN AGAIN" },
  MALFORMED: { bg: "bg-red-600", label: "SCAN ERROR" },
};

export default function CheckInScanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled || !containerRef.current) return;

      const scanner = new Html5Qrcode(containerRef.current.id);
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            if (processingRef.current) return;
            processingRef.current = true;
            await handleScan(decodedText);
            processingRef.current = false;
          },
          undefined,
        );
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : "Failed to access camera");
      }
    }

    async function handleScan(token: string) {
      try {
        const res = await fetch("/api/checkin-station", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = (await res.json().catch(() => ({ result: "MALFORMED" }))) as ScanOutcome;
        setOutcome(body);
        setTimeout(() => setOutcome(null), 2500);
      } catch {
        setOutcome({ result: "MALFORMED" });
        setTimeout(() => setOutcome(null), 2500);
      }
    }

    start();

    return () => {
      cancelled = true;
      scannerRef.current
        ?.stop()
        .then(() => scannerRef.current?.clear())
        .catch(() => {});
    };
  }, []);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 px-4 text-white">
      <h1 className="text-xl font-semibold">Scan the gym&apos;s check-in code</h1>
      <div id="member-checkin-reader" ref={containerRef} className="w-full max-w-md overflow-hidden rounded-xl" />
      {cameraError && <p className="text-red-400">{cameraError}</p>}
      <a href="/my-qr" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← Back to my QR
      </a>

      {outcome && (
        <div
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 ${OVERLAY_STYLE[outcome.result].bg}`}
        >
          <p className="text-4xl font-bold text-center px-4">{OVERLAY_STYLE[outcome.result].label}</p>
          {outcome.member && <p className="text-xl">{outcome.member.fullName}</p>}
        </div>
      )}
    </main>
  );
}
