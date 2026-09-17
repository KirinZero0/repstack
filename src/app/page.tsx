import GymSlugForm from "./GymSlugForm";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-950 px-4 text-white">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Iron Ledger</h1>
        <p className="mt-2 text-neutral-400">Gym membership management</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-4">
        <a
          href="/superadmin/login"
          className="rounded-md border border-neutral-700 px-4 py-3 text-center hover:bg-neutral-900"
        >
          Superadmin login
        </a>

        <GymSlugForm />
      </div>
    </main>
  );
}
