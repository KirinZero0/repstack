"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ScanResultModal from "@/components/ScanResultModal";

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

const OVERLAY_STYLE: Record<ResultCode, { tone: "success" | "warning" | "error"; label: string }> = {
  SUCCESS: { tone: "success", label: "Checked in" },
  DUPLICATE: { tone: "warning", label: "Already checked in today" },
  EXPIRED: { tone: "error", label: "Membership expired" },
  FROZEN: { tone: "error", label: "Membership frozen" },
  INVALID: { tone: "error", label: "Not a valid check-in code" },
  GYM_SUSPENDED: { tone: "error", label: "Gym account suspended" },
  UNAUTHENTICATED: { tone: "error", label: "Session expired — log in again" },
  MALFORMED: { tone: "error", label: "Scan error" },
};

const SHOW_MS = 2500;
// The code is usually still in front of the camera when the modal closes; pause so it isn't re-scanned at once.
const COOLDOWN_MS = 1500;

export default function CheckInScanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
    setOutcome(null);
    setTimeout(() => {
      processingRef.current = false;
    }, COOLDOWN_MS);
  }, []);

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
        show(OVERLAY_STYLE[body.result] ? body : { result: "MALFORMED" });
      } catch {
        show({ result: "MALFORMED" });
      }
    }

    function show(next: ScanOutcome) {
      setOutcome(next);
      dismissTimer.current = setTimeout(dismiss, SHOW_MS);
    }

    start();

    return () => {
      cancelled = true;
      scannerRef.current
        ?.stop()
        .then(() => scannerRef.current?.clear())
        .catch(() => {});
    };
  }, [dismiss]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 px-4 text-white">
      <h1 className="text-xl font-semibold">Scan the gym&apos;s check-in code</h1>
      <div id="member-checkin-reader" ref={containerRef} className="w-full max-w-md overflow-hidden rounded-xl" />
      {cameraError && <p className="text-red-400">{cameraError}</p>}
      <a href="/my-qr" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← Back to my QR
      </a>

      {outcome && (
        <ScanResultModal
          tone={OVERLAY_STYLE[outcome.result].tone}
          label={OVERLAY_STYLE[outcome.result].label}
          name={outcome.member?.fullName}
          durationMs={SHOW_MS}
          onClose={dismiss}
        />
      )}
    </main>
  );
}
