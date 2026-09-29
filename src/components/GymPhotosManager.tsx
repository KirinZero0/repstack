"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { resizeImageToMaxWidth } from "@/lib/resizeImage";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Owner-only: the photo grid on the settings page, with upload and remove. */
export default function GymPhotosManager({ slug, photos, max }: { slug: string; photos: string[]; max: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = photos.length >= max;

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setError("Photo must be JPEG, PNG, or WebP");
        return;
      }
      // Shrink on the phone before sending: a 12MP camera shot becomes a few hundred KB. If the
      // browser can't resize (very old or odd image), send the original as long as it's small enough.
      let body: Blob = file;
      try {
        body = await resizeImageToMaxWidth(file, 1600);
      } catch {
        if (file.size > MAX_UPLOAD_BYTES) {
          setError("Photo must be under 5MB");
          return;
        }
      }
      const fd = new FormData();
      fd.set("photo", body, "photo.jpg");
      const res = await fetch(`/api/${slug}/photos`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Upload failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(url: string) {
    if (!window.confirm("Remove this photo from your page?")) return;
    setBusy(url);
    setError(null);
    const res = await fetch(`/api/${slug}/photos/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not remove the photo");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400">
        Up to {max} photos, shown on your public page in this order. Landscape shots of the floor, equipment and entrance work best.
      </p>
      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((url, i) => (
            <li key={url} className="group relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Gym photo ${i + 1}`} className="aspect-[4/3] w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(url)}
                disabled={busy === url}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute right-2 top-2 rounded-md bg-neutral-950/80 px-2 py-1 text-xs text-white hover:bg-red-950 hover:text-red-400 disabled:opacity-50"
              >
                {busy === url ? "…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">No photos yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className={`rounded-md px-4 py-2 text-sm font-medium ${full || busy === "upload" ? "cursor-not-allowed bg-neutral-800 text-neutral-500" : "cursor-pointer bg-white text-neutral-950 hover:bg-neutral-200"}`}>
          {busy === "upload" ? "Uploading…" : "Add photo"}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={full || busy === "upload"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
            className="sr-only"
          />
        </label>
        <span className="text-xs text-neutral-500">
          {photos.length} of {max}
          {full && " · remove one to add another"}
        </span>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
