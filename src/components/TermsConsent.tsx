"use client";

/** The consent checkbox every public form shows. The server checks it again and stores when it was given. */
export default function TermsConsent({
  checked,
  onChange,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
}) {
  return (
    <div>
      <label htmlFor="acceptTerms" className="flex items-start gap-3 text-sm text-neutral-300">
        <input
          id="acceptTerms"
          type="checkbox"
          required
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span>
          I agree to the{" "}
          <a href="/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">
            Privacy Policy
          </a>
          .
        </span>
      </label>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}
