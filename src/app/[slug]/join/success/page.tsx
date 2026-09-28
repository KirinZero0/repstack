import { redirect } from "next/navigation";
import JoinStatus from "./JoinStatus";

export const dynamic = "force-dynamic";

export default function JoinSuccessPage({ params, searchParams }: { params: { slug: string }; searchParams: { id?: string } }) {
  if (!searchParams.id) redirect(`/${params.slug}/join`);
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-16 text-white">
      <div className="mx-auto max-w-xl">
        <JoinStatus slug={params.slug} signupId={searchParams.id} />
      </div>
    </main>
  );
}
