import { redirect } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import { isMockMode } from "@/lib/xendit";
import SignupStatus from "./SignupStatus";

export const dynamic = "force-dynamic";

export default function SignupSuccessPage({ searchParams }: { searchParams: { id?: string } }) {
  if (!searchParams.id) redirect("/#pricing");
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-6">
          <BrandMark />
        </div>
      </header>
      <div className="mx-auto max-w-xl px-6 py-16">
        <SignupStatus signupId={searchParams.id} mock={isMockMode()} />
      </div>
    </main>
  );
}
