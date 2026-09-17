"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GymSlugForm() {
  const router = useRouter();
  const [slug, setSlug] = useState("");

  function goTo(path: "login" | "member-login") {
    if (!slug.trim()) return;
    router.push(`/g/${slug.trim()}/${path}`);
  }

  return (
    <div className="rounded-md border border-neutral-700 p-4">
      <label className="mb-2 block text-sm text-neutral-400">Gym slug</label>
      <input
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="e.g. demo"
        className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-neutral-500"
      />
      <div className="flex gap-2">
        <button
          onClick={() => goTo("login")}
          className="flex-1 rounded-md bg-white py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200"
        >
          Staff login
        </button>
        <button
          onClick={() => goTo("member-login")}
          className="flex-1 rounded-md border border-neutral-700 py-2 text-sm text-neutral-300 hover:bg-neutral-900"
        >
          Member login
        </button>
      </div>
    </div>
  );
}
