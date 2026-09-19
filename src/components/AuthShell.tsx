import BrandMark, { PlateGlyph } from "./BrandMark";

/** Split layout for login screens: brand panel on the left (hidden on small screens), form on the right. */
export default function AuthShell({ children, tagline }: { children: React.ReactNode; tagline: string }) {
  return (
    <main className="grid min-h-screen bg-neutral-950 lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-neutral-800 bg-neutral-900 p-10 lg:flex">
        <BrandMark />
        <div className="relative z-10">
          <p className="max-w-xs font-display text-3xl font-semibold leading-tight text-white">{tagline}</p>
        </div>
        {/* stacked plates, bleeding off the corner */}
        <div className="pointer-events-none absolute -bottom-16 -right-16 flex flex-col items-end gap-3 opacity-90" aria-hidden="true">
          <PlateGlyph size={220} color="var(--plate-red)" />
          <span className="-mt-24 mr-16 block"><PlateGlyph size={170} color="var(--plate-blue)" /></span>
          <span className="-mt-20 mr-8 block"><PlateGlyph size={120} color="var(--plate-green)" /></span>
        </div>
      </aside>
      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><BrandMark /></div>
          {children}
        </div>
      </section>
    </main>
  );
}
