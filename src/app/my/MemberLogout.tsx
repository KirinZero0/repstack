"use client";

import { useRouter } from "next/navigation";

export default function MemberLogout({ slug }: { slug: string }) {
  const router = useRouter();

  async function logout() {
    await fetch(`/api/${slug}/member-logout`, { method: "POST" });
    router.push(`/${slug}/login`);
    router.refresh();
  }

  return (
    <button onClick={logout} className="text-neutral-300 hover:text-white">
      Log out
    </button>
  );
}
