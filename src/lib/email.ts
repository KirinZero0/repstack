export interface EmailResult {
  ok: boolean;
  /** True when nothing was sent because email isn't set up on the platform. */
  skipped?: boolean;
  error?: string;
}

function isMock(): boolean {
  return process.env.EMAIL_MOCK === "1" && process.env.NODE_ENV !== "production";
}

/** Email works once the platform has a Resend key and a verified sender address (mock mode counts, dev/test only). */
export function emailConfigured(): boolean {
  return isMock() || Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** A display name can't contain the characters that delimit an address header. */
function safeName(name: string): string {
  return name.replace(/[<>",\r\n]/g, "").trim().slice(0, 60) || "Liftmora";
}

/**
 * Sends one plain-text email through Resend. `fromName` is the gym's name, so the sender reads as the
 * gym while the address itself stays the platform's verified one.
 */
export async function sendEmail(opts: { to: string; subject: string; text: string; fromName: string }): Promise<EmailResult> {
  if (isMock()) {
    console.log(`[email:mock] ${opts.fromName} -> ${opts.to}: ${opts.subject}`);
    // A recipient containing "+bounce" simulates the provider rejecting the address.
    return opts.to.includes("+bounce") ? { ok: false, error: "Address rejected" } : { ok: true };
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    console.log(`[email:skipped] email isn't configured, would send to ${opts.to}: ${opts.subject}`);
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${safeName(opts.fromName)} <${from}>`, to: [opts.to], subject: opts.subject, text: opts.text }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { message?: unknown };
    return { ok: false, error: String(body.message ?? `Email provider returned HTTP ${res.status}`) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
