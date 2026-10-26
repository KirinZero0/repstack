"use client";

import { useEffect, useState } from "react";
import { useInstall } from "@/lib/pwaInstall";

const step = "flex gap-3";
const num = "flex h-6 w-6 flex-none items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold text-white";

/** The iOS "Share" glyph (a square with an arrow out of the top), so people can spot it in Safari's toolbar. */
function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-text-bottom" aria-label="Share">
      <path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className={step}>
      <span className={num}>{n}</span>
      <span className="text-neutral-300">{children}</span>
    </li>
  );
}

/**
 * A clear "Install the app" button. Where the browser allows it, one tap installs. Everywhere else
 * (iPhone, Mac Safari, a browser that hasn't offered the prompt) it opens a short guide for exactly
 * that device, because the steps are different on each. Hidden once installed, and on browsers that
 * can't install web apps at all.
 */
export default function InstallAppButton() {
  const { kind, install } = useInstall();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!kind || kind === "installed" || kind === "unsupported") return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      window.prompt("Copy this link:", window.location.href);
    }
  }

  async function onClick() {
    if (kind === "native") {
      await install();
      return;
    }
    setOpen(true);
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onClick}
        data-testid="install-app-button"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-900"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        Install the app
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="How to install Liftmora"
            data-testid="install-guide"
            className="w-full max-w-sm rounded-2xl border border-neutral-700 bg-neutral-900 p-5 text-sm text-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Install Liftmora</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-white">
                ✕
              </button>
            </div>

            {kind === "ios-safari" && (
              <ol className="space-y-3">
                <Step n={1}>
                  Tap the <strong>Share</strong> button <ShareIcon /> in Safari&apos;s bottom bar (top right on an iPad).
                </Step>
                <Step n={2}>
                  Scroll down in the list and tap <strong>Add to Home Screen</strong>.
                </Step>
                <Step n={3}>
                  Tap <strong>Add</strong>. The Liftmora icon appears on your home screen.
                </Step>
              </ol>
            )}

            {kind === "ios-other" && (
              <>
                <p className="mb-3 text-neutral-300">
                  iPhones can only install apps from <strong>Safari</strong>, not from Chrome or other apps. It takes a few seconds:
                </p>
                <ol className="space-y-3">
                  <Step n={1}>
                    <button type="button" onClick={copyLink} data-testid="copy-link" className="rounded-md bg-white px-3 py-1.5 font-semibold text-neutral-950 hover:bg-neutral-200">
                      {copied ? "Copied ✓" : "Copy link"}
                    </button>
                  </Step>
                  <Step n={2}>
                    Open <strong>Safari</strong> (the blue compass), tap the address bar, paste the link and go.
                  </Step>
                  <Step n={3}>
                    Tap <strong>Share</strong> <ShareIcon />, scroll down, tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
                  </Step>
                </ol>
              </>
            )}

            {kind === "mac-safari" && (
              <ol className="space-y-3">
                <Step n={1}>
                  In the menu bar at the top of your screen, click <strong>File</strong>.
                </Step>
                <Step n={2}>
                  Choose <strong>Add to Dock…</strong>, then <strong>Add</strong>.
                </Step>
              </ol>
            )}

            {kind === "android" && (
              <ol className="space-y-3">
                <Step n={1}>
                  Tap the browser menu <strong>⋮</strong> (top right).
                </Step>
                <Step n={2}>
                  Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm.
                </Step>
              </ol>
            )}

            {kind === "desktop-chromium" && (
              <ol className="space-y-3">
                <Step n={1}>
                  Look at the right end of the address bar for the <strong>install icon</strong> (a small monitor with a down arrow) and click it.
                </Step>
                <Step n={2}>
                  Not there? Open the browser menu <strong>⋮</strong> and choose <strong>Install Liftmora</strong> (in Edge: Apps, then <strong>Install this site as an app</strong>).
                </Step>
              </ol>
            )}

            <button type="button" onClick={() => setOpen(false)} className="mt-5 w-full rounded-lg border border-neutral-700 px-4 py-2 text-neutral-300 hover:bg-neutral-800">
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
