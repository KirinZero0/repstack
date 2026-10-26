"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Chrome and Android's install prompt event, which TypeScript's DOM types don't include. */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "liftmora.install.dismissed";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Where an install nudge makes sense: inside the app (a member's pages, the superadmin area, a gym's
 * staff screens), never on the marketing site, login, legal pages, or one-off links like a guest ticket.
 */
const APP_PATH = /^\/(my(\/|$)|superadmin\/(?!login)|[^/]+\/(dashboard|checkin|attendance|members|classes|plans|finance|staff|billing|settings)(\/|$))/;
const NOT_A_GYM = new Set(["api", "activate", "reset", "forgot", "ticket", "check-in", "my-qr", "demo", "features", "signup", "login", "privacy", "terms", "open", "offline"]);

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Boolean(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function alreadyInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Registers the service worker (production only, so local development and tests aren't confused by a
 * cache) and, inside the app, offers to install it: a button on Chrome and Android, and the
 * "Share → Add to Home Screen" steps on iPhone, which has no install prompt of its own.
 */
export default function PwaSupport() {
  const pathname = usePathname();
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker not registered", err));
    }

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !("MSStream" in window);
    setIos(isIos);
    setHidden(alreadyInstalled() || snoozed());

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the browser's own mini-bar away; we show our own, at a better moment
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => {
      setEvent(null);
      setHidden(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const first = pathname.split("/")[1] ?? "";
  const inApp = APP_PATH.test(pathname) && !(first !== "my" && first !== "superadmin" && NOT_A_GYM.has(first));
  if (hidden || !inApp || (!event && !ios)) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      /* private mode: it just comes back next visit */
    }
    setHidden(true);
  }

  async function install() {
    if (!event) return;
    await event.prompt();
    const choice = await event.userChoice.catch(() => null);
    setEvent(null);
    if (choice?.outcome === "dismissed") dismiss();
    else setHidden(true);
  }

  return (
    <div
      role="dialog"
      aria-label="Install Liftmora"
      data-testid="install-prompt"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-sm text-white shadow-lg"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <p className="font-medium">Install Liftmora</p>
      <p className="mt-1 text-neutral-400">
        {event ? "Add it to your home screen to open it like an app, full screen." : "On iPhone: tap the Share button, then “Add to Home Screen”."}
      </p>
      <div className="mt-3 flex gap-2">
        {event && (
          <button onClick={install} className="rounded-lg bg-white px-4 py-2 font-semibold text-neutral-950 hover:bg-neutral-200">
            Install
          </button>
        )}
        <button onClick={dismiss} className="rounded-lg border border-neutral-700 px-4 py-2 text-neutral-300 hover:bg-neutral-800">
          Not now
        </button>
      </div>
    </div>
  );
}
