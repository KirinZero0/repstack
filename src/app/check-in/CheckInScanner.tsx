"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ScanResultModal from "@/components/ScanResultModal";
import { describeCameraError, hasTorch, setTorch, startQrScanner, stopQrScanner } from "@/lib/scanner";

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
  /** Explains a refusal more specifically than the default label (e.g. the daily limit). */
  message?: string;
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
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
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
    let starting: Promise<import("html5-qrcode").Html5Qrcode> | null = null;

    async function start() {
      if (cancelled || !containerRef.current) return;
      try {
        starting = startQrScanner(containerRef.current.id, async (decodedText) => {
          if (processingRef.current) return;
          processingRef.current = true;
          await handleScan(decodedText);
        });
        const scanner = await starting;
        if (cancelled) return;
        scannerRef.current = scanner;
        setTorchAvailable(hasTorch(scanner));
      } catch (err) {
        if (!cancelled) setCameraError(describeCameraError(err));
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
      if (starting) stopQrScanner(starting);
      scannerRef.current = null;
    };
  }, [dismiss]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 px-4 text-white">
      <h1 className="text-xl font-semibold">Scan the gym&apos;s check-in code</h1>
      <div id="member-checkin-reader" ref={containerRef} className="w-full max-w-md overflow-hidden rounded-xl" />
      {cameraError && <p className="max-w-md text-center text-red-400">{cameraError}</p>}
      {torchAvailable && (
        <button
          type="button"
          onClick={() => {
            const next = !torchOn;
            if (scannerRef.current) setTorch(scannerRef.current, next).then(() => setTorchOn(next)).catch(() => {});
          }}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          {torchOn ? "Turn light off" : "Turn light on"}
        </button>
      )}
      <a href="/my-qr" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← Back to my QR
      </a>

      {outcome && (
        <ScanResultModal
          tone={OVERLAY_STYLE[outcome.result].tone}
          label={outcome.message ?? OVERLAY_STYLE[outcome.result].label}
          name={outcome.member?.fullName}
          durationMs={SHOW_MS}
          onClose={dismiss}
        />
      )}
    </main>
  );
}
