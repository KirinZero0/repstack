import BrandMark from "./BrandMark";

/** Shared frame for the terms and privacy pages. */
export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <BrandMark />
          <a href="/" className="text-sm text-neutral-400 hover:text-white">← Home</a>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-6 py-12 text-neutral-300 [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_li]:mt-1.5 [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
        <h1 className="font-display text-3xl font-semibold text-white sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-neutral-500">Last updated {updated}</p>
        {children}
      </article>
      <footer className="border-t border-neutral-800 py-6 text-center text-sm text-neutral-500">
        <a href="/terms" className="hover:text-white">Terms of Service</a>
        <span className="mx-3">·</span>
        <a href="/privacy" className="hover:text-white">Privacy Policy</a>
      </footer>
    </main>
  );
}

/** Where people reach us. Set NEXT_PUBLIC_CONTACT_EMAIL in the environment; without it the pages point them to their gym. */
export function ContactLine() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return email ? (
    <a href={`mailto:${email}`} className="underline underline-offset-2 hover:text-white">{email}</a>
  ) : (
    <span>the contact address on your invoice or through your gym</span>
  );
}
