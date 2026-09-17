import { getSession } from "@/lib/session";
import CheckInScanner from "./CheckInScanner";

export default async function MemberCheckInPage() {
  const session = await getSession();

  if (!session || session.kind !== "member") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <div className="text-center">
          <p className="mb-4 text-neutral-300">Log in as a member to check yourself in.</p>
          <a href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Back home
          </a>
        </div>
      </main>
    );
  }

  return <CheckInScanner />;
}
