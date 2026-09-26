"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resizeImageTo512 } from "@/lib/resizeImage";
import TermsConsent from "@/components/TermsConsent";

interface ActivateInfo {
  fullName: string;
  email: string;
  alreadyActivated: boolean;
  gymSlug: string | null;
}

export default function ActivatePage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const [info, setInfo] = useState<ActivateInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/activate/${params.token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setLoadError(body.error ?? "Link is invalid or expired");
          return;
        }
        setInfo(await res.json());
      })
      .catch(() => setLoadError("Failed to load activation link"));
  }, [params.token]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPhotoFile(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("password", password);
      formData.set("acceptTerms", String(acceptTerms));
      if (photoFile) {
        const resized = await resizeImageTo512(photoFile);
        formData.set("photo", resized, "profile.jpg");
      }

      const res = await fetch(`/api/activate/${params.token}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Activation failed");
        return;
      }
      setDone(true);
      if (info?.gymSlug) {
        setTimeout(() => router.push(`/g/${info.gymSlug}/login`), 1500);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">{loadError}</p>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-neutral-400">Loading…</p>
      </main>
    );
  }

  if (info.alreadyActivated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <div className="text-center">
          <p className="mb-4">This account is already activated.</p>
          {info.gymSlug && (
            <a href={`/g/${info.gymSlug}/login`} className="text-white underline">
              Go to login →
            </a>
          )}
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p>Account activated! Redirecting to login…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl"
      >
        <h1 className="mb-1 text-xl font-semibold text-white">Activate your account</h1>
        <p className="mb-6 text-sm text-neutral-400">
          {info.fullName} · {info.email}
        </p>

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Profile preview"
            className="mb-4 h-24 w-24 rounded-full object-cover"
          />
        )}
        <label htmlFor="photo" className="mb-1 block text-sm text-neutral-300">Profile picture (optional)</label>
        <input
          id="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handlePhotoChange}
          className="mb-4 w-full text-sm text-neutral-300"
        />

        <label htmlFor="password" className="mb-1 block text-sm text-neutral-300">Password</label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-neutral-500"
        />

        <label htmlFor="confirmPassword" className="mb-1 block text-sm text-neutral-300">Confirm password</label>
        <input
          id="confirmPassword"
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mb-4 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-neutral-500"
        />

        <div className="mb-4">
          <TermsConsent checked={acceptTerms} onChange={setAcceptTerms} />
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-white py-2 font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-50"
        >
          {submitting ? "Activating…" : "Activate account"}
        </button>
      </form>
    </main>
  );
}
