/** A weight plate seen edge-on: ring + hollow hub. Inherits colour from the surrounding text. */
export function PlateGlyph({ size = 28, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" style={color ? { color } : undefined}>
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="4" />
      <circle cx="16" cy="16" r="4" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}

export default function BrandMark({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="inline-flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-white">
      <span className="text-plate-yellow">
        <PlateGlyph size={26} />
      </span>
      Iron Ledger
    </a>
  );
}
