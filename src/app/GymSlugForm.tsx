"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GymSlugForm() {
  const router = useRouter();
  const [slug, setSlug] = useState("");

  function goTo(path: "login" | "member-login") {
    const clean = slug.trim().toLowerCase();
    if (!clean) return;
    router.push(`/g/${clean}/${path}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        goTo("login");
      }}
    >
      <label htmlFor="gym-slug" className="mb-2 block text-sm text-neutral-300">
        Gym short name
      </label>
      <input
        id="gym-slug"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="for example: demo"
        autoCapitalize="none"
        className="mb-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none placeholder:text-neutral-500 focus:border-plate-blue"
      />
      <div className="flex gap-2">
        <button type="submit" className="flex-1 rounded-lg bg-white py-2.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
          Staff log in
        </button>
        <button
          type="button"
          onClick={() => goTo("member-login")}
          className="flex-1 rounded-lg border border-neutral-700 py-2.5 text-sm font-semibold text-white hover:bg-neutral-900"
        >
          Member log in
        </button>
      </div>
    </form>
  );
}
