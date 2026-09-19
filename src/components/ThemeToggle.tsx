"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";
const NEXT: Record<Mode, Mode> = { dark: "light", light: "system", system: "dark" };
const ICON: Record<Mode, string> = { dark: "☾", light: "☀", system: "◐" };

/** Cycles dark → light → system, remembered in a cookie so the server renders the right theme. */
export default function ThemeToggle({ initial }: { initial: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initial);
  useEffect(() => setMode(initial), [initial]);

  function cycle() {
    const next = NEXT[mode];
    setMode(next);
    document.cookie = `il_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <button
      onClick={cycle}
      aria-label={`Theme: ${mode}. Click to change.`}
      title={`Theme: ${mode}`}
      className="fixed bottom-4 right-4 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-white shadow print:hidden"
    >
      {ICON[mode]}
    </button>
  );
}
