"use client";

import { useState } from "react";

/**
 * Downloads a file from `href` under a name we pick. A plain `<a download>` lets the browser name the
 * file, and it falls back to the last URL segment ("export", no extension) whenever it distrusts the
 * response headers, e.g. on a self-signed or plain-http origin. Fetching the bytes ourselves and saving
 * them from a blob URL keeps the name and the .csv extension no matter what.
 */
export default function DownloadButton({
  href,
  fallbackName,
  className,
  disabled,
  children,
}: {
  href: string;
  fallbackName: string;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Download failed. Try signing in again.");
        return;
      }
      const name = /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
      const blob = new Blob([await res.blob()], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("Download failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={download} disabled={disabled || busy} className={`${className ?? ""} disabled:pointer-events-none disabled:opacity-50`}>
        {busy ? "Preparing…" : children}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  );
}
