"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/** Chrome and Android's install prompt event, which TypeScript's DOM types don't include. */
export interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/*
 * One place that catches the browser's install prompt, so the login-page button and the in-app
 * banner share it (the browser only offers the prompt once per page load). The listener is attached
 * as soon as this module loads, early enough not to miss it.
 */
let deferred: InstallEvent | null = null;
let installed = false;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep the browser's own mini-bar away; we show our own, where it's useful
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}
start();

const subscribe = (cb: () => void) => {
  start();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** What this device can do about installing, which decides what the button does or says. */
export type InstallKind =
  | "installed" //        already running as an installed app
  | "native" //           the browser gave us its install prompt: one tap
  | "ios-safari" //       iPhone/iPad Safari: Share → Add to Home Screen
  | "ios-other" //        iPhone/iPad but not Safari (Chrome, Firefox, an in-app browser): only Safari can install
  | "mac-safari" //       Safari on a Mac: File → Add to Dock
  | "android" //          Android, no prompt yet: browser menu → Install app
  | "desktop-chromium" // Chrome/Edge on a computer, no prompt yet: address-bar icon or menu
  | "unsupported"; //     e.g. Firefox on a computer, which can't install web apps

export function detectInstallKind(): InstallKind {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";

  // Newer iPads present themselves as a Mac but have a touch screen; a real Mac has none.
  const iPadAsMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadAsMac) {
    // Apps and other browsers on iOS can't add to the home screen (or don't show it). Only Safari reliably does.
    const notSafari = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo/.test(ua) || !/Safari\//.test(ua);
    return notSafari ? "ios-other" : "ios-safari";
  }
  if (/Firefox\//.test(ua) && !/Android|Mobile|Tablet/.test(ua)) return "unsupported";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua)) return "mac-safari";
  if (/Android/.test(ua)) return "android";
  if (/Chrome|Chromium|Edg|OPR/.test(ua)) return "desktop-chromium";
  return "unsupported";
}

/** The install state for this device. `kind` is null until the page has loaded (the server can't know). */
export function useInstall() {
  const event = useSyncExternalStore(subscribe, () => deferred, () => null);
  const wasInstalled = useSyncExternalStore(subscribe, () => installed, () => false);
  const [kind, setKind] = useState<InstallKind | null>(null);
  useEffect(() => setKind(detectInstallKind()), []);

  const effective: InstallKind | null = kind === null ? null : wasInstalled || kind === "installed" ? "installed" : event ? "native" : kind;

  /** Shows the browser's own install dialog. Returns what the person chose. */
  async function install(): Promise<"accepted" | "dismissed" | "unavailable"> {
    const e = deferred;
    if (!e) return "unavailable";
    deferred = null; // each prompt can only be used once
    emit();
    await e.prompt();
    const choice = await e.userChoice.catch(() => null);
    return choice?.outcome ?? "dismissed";
  }

  return { kind: effective, install };
}
