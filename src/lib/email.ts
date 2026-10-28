export interface EmailResult {
  ok: boolean;
  /** True when nothing was sent because email isn't set up on the platform. */
  skipped?: boolean;
  error?: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Where a member's reply goes (the gym's own address); optional. */
  replyTo?: string;
}

type Provider = "mailgun" | "mailjet" | "resend";

function isMock(): boolean {
  return process.env.EMAIL_MOCK === "1" && process.env.NODE_ENV !== "production";
}

/**
 * Which provider sends email: EMAIL_PROVIDER if set, otherwise the first of Mailgun, Mailjet, Resend
 * that has its credentials. null means email isn't set up.
 */
function provider(): Provider | null {
  const ready: Record<Provider, boolean> = {
    mailgun: Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN),
    // Mailjet only sends from a sender address or domain verified in its dashboard, so EMAIL_FROM is required.
    mailjet: Boolean(process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY && process.env.EMAIL_FROM),
    resend: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  };
  const chosen = process.env.EMAIL_PROVIDER?.toLowerCase();
  if (chosen === "mailgun" || chosen === "mailjet" || chosen === "resend") return ready[chosen] ? chosen : null;
  return (["mailgun", "mailjet", "resend"] as const).find((p) => ready[p]) ?? null;
}

/** Email works once a provider is configured on the platform (mock mode counts, dev/test only). */
export function emailConfigured(): boolean {
  return isMock() || provider() !== null;
}

/** Every email leaves from Liftmora's one address; which gym it is about is told by the template. */
function fromHeader(address: string): string {
  return `${safeName(process.env.EMAIL_FROM_NAME || "Liftmora")} <${address}>`;
}

/** A display name can't contain the characters that delimit an address header. */
function safeName(name: string): string {
  return name.replace(/[<>",\r\n]/g, "").trim().slice(0, 60) || "Liftmora";
}

async function failure(res: Response): Promise<EmailResult> {
  const body = (await res.json().catch(() => ({}))) as { message?: unknown };
  return { ok: false, error: String(body.message ?? `Email provider returned HTTP ${res.status}`) };
}

async function sendViaMailgun(e: OutgoingEmail): Promise<EmailResult> {
  const domain = process.env.MAILGUN_DOMAIN!;
  const host = process.env.MAILGUN_REGION?.toLowerCase() === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
  const address = process.env.EMAIL_FROM || `no-reply@${domain}`;
  const form = new URLSearchParams({
    from: fromHeader(address),
    to: e.to,
    subject: e.subject,
    text: e.text,
  });
  if (e.html) form.set("html", e.html);
  if (e.replyTo) form.set("h:Reply-To", e.replyTo);
  const res = await fetch(`https://${host}/v3/${encodeURIComponent(domain)}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64")}` },
    body: form,
  });
  return res.ok ? { ok: true } : failure(res);
}

async function sendViaMailjet(e: OutgoingEmail): Promise<EmailResult> {
  const auth = Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`).toString("base64");
  const res = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: process.env.EMAIL_FROM, Name: safeName(process.env.EMAIL_FROM_NAME || "Liftmora") },
          To: [{ Email: e.to }],
          Subject: e.subject,
          TextPart: e.text,
          ...(e.html ? { HTMLPart: e.html } : {}),
          ...(e.replyTo ? { ReplyTo: { Email: e.replyTo } } : {}),
        },
      ],
    }),
  });
  // Mailjet can answer 200 with a per-message error, so the message's own status is the truth.
  const body = (await res.json().catch(() => ({}))) as {
    ErrorMessage?: unknown;
    Messages?: { Status?: string; Errors?: { ErrorMessage?: unknown }[] }[];
  };
  const msg = body.Messages?.[0];
  if (res.ok && (!msg || msg.Status === "success")) return { ok: true };
  return { ok: false, error: String(msg?.Errors?.[0]?.ErrorMessage ?? body.ErrorMessage ?? `Email provider returned HTTP ${res.status}`) };
}

async function sendViaResend(e: OutgoingEmail): Promise<EmailResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromHeader(process.env.EMAIL_FROM!),
      to: [e.to],
      subject: e.subject,
      text: e.text,
      ...(e.html ? { html: e.html } : {}),
      ...(e.replyTo ? { reply_to: e.replyTo } : {}),
    }),
  });
  return res.ok ? { ok: true } : failure(res);
}

/** Sends one email through the configured provider. Never throws. */
export async function sendEmail(opts: OutgoingEmail): Promise<EmailResult> {
  if (isMock()) {
    console.log(`[email:mock] ${opts.to}: ${opts.subject}`);
    // A recipient containing "+bounce" simulates the provider rejecting the address.
    return opts.to.includes("+bounce") ? { ok: false, error: "Address rejected" } : { ok: true };
  }
  const p = provider();
  if (!p) {
    console.log(`[email:skipped] email isn't configured, would send to ${opts.to}: ${opts.subject}`);
    return { ok: false, skipped: true };
  }
  try {
    return await (p === "mailgun" ? sendViaMailgun(opts) : p === "mailjet" ? sendViaMailjet(opts) : sendViaResend(opts));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
