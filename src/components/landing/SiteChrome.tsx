import BrandMark from "@/components/BrandMark";

/** The marketing pages' header: home, features, pricing, demo, log in. Anchors resolve on the home page. */
export function SiteHeader({ current }: { current?: "home" | "features" }) {
  const link = (active: boolean) => `hover:text-white ${active ? "text-white" : ""}`;
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <BrandMark />
        <nav className="flex items-center gap-6 text-sm text-neutral-300">
          <a href="/features" className={link(current === "features")}>Features</a>
          <a href="/#pricing" className="hidden hover:text-white sm:inline">Pricing</a>
          <a href="/demo" className="hidden hover:text-white sm:inline">Demo</a>
          <a href="/#faq" className="hidden hover:text-white md:inline">FAQ</a>
          <a href="/login" className="rounded-full bg-white px-4 py-1.5 font-medium text-neutral-950 hover:bg-neutral-200">
            Log in
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-800">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-neutral-500">
        <BrandMark />
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a href="/features" className="hover:text-neutral-300">Features</a>
          <a href="/#pricing" className="hover:text-neutral-300">Pricing</a>
          <a href="/demo" className="hover:text-neutral-300">Demo</a>
          <a href="/terms" className="hover:text-neutral-300">Terms</a>
          <a href="/privacy" className="hover:text-neutral-300">Privacy</a>
          <a href="/superadmin/login" className="hover:text-neutral-300">Platform admin</a>
        </nav>
      </div>
    </footer>
  );
}
