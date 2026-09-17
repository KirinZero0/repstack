"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton({ slug }: { slug: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch(`/api/g/${slug}/staff-logout`, { method: "POST" });
    router.push(`/g/${slug}/login`);
    router.refresh();
  }

  return (
    <button onClick={handleLogout} className="text-neutral-300 hover:text-white">
      Log out
    </button>
  );
}
