import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_BRAND,
  EMAIL_DESIGN,
  EMAIL_LIMITS,
  EMAIL_PLACEHOLDERS,
  isEmailMessageType,
  type EmailMessageType,
  type EmailTemplate,
} from "@/config/email";

export type EmailVars = Record<keyof typeof EMAIL_PLACEHOLDERS, string>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;


/** The first reason a template can't be saved, or null. Only known placeholders are allowed. */
export function templateError(t: { subject: string; body: string }): string | null {
  if (!t.subject.trim() || !t.body.trim()) return "A template needs both a subject and a body.";
  if (t.subject.length > EMAIL_LIMITS.subject) return `The subject can be at most ${EMAIL_LIMITS.subject} characters.`;
  if (t.body.length > EMAIL_LIMITS.body) return `The body can be at most ${EMAIL_LIMITS.body} characters.`;
  if (/[\r\n]/.test(t.subject)) return "The subject must be a single line.";
  for (const text of [t.subject, t.body]) {
    for (const m of Array.from(text.matchAll(PLACEHOLDER_RE))) {
      if (!(m[1] in EMAIL_PLACEHOLDERS)) return `{{${m[1]}}} isn't a placeholder. Use ${Object.keys(EMAIL_PLACEHOLDERS).map((k) => `{{${k}}}`).join(", ")}.`;
    }
  }
  if (!/\{\{\s*message\s*\}\}/.test(t.body)) return "The body must include {{message}}, or members would miss their link or dates.";
  return null;
}

/** Fills placeholders in one pass, so a value containing "{{...}}" is never expanded again. */
export function renderText(template: string, vars: EmailVars): string {
  return template.replace(PLACEHOLDER_RE, (_, name: string) => (name in vars ? vars[name as keyof EmailVars] : ""));
}

/** A stored template row. `gymId: null` is a platform default; otherwise it belongs to that gym. */
export interface TemplateRow {
  gymId: string | null;
  type: string;
  subject: string;
  body: string;
}

/**
 * The template for a message, most specific first: the gym's own for that type, the gym's own
 * "everything else", the platform default for that type, the platform "everything else", and finally
 * the wording built into the app (src/config/email.ts), so a missing row never means no email.
 * `rows` may hold any gyms' rows; only this gym's and the platform's are considered.
 */
export function resolveTemplate(rows: TemplateRow[], gymId: string | null, type: string): EmailTemplate {
  const key: EmailMessageType = isEmailMessageType(type) ? type : "default";
  const find = (owner: string | null, t: string) => rows.find((r) => r.gymId === owner && r.type === t);
  const hit =
    (gymId && (find(gymId, key) ?? find(gymId, "default"))) || find(null, key) || find(null, "default") || undefined;
  return hit ? { subject: hit.subject, body: hit.body } : DEFAULT_EMAIL_TEMPLATES[key];
}

export function renderEmail(rows: TemplateRow[], gymId: string | null, type: string, vars: EmailVars): { subject: string; text: string; html: string } {
  const t = resolveTemplate(rows, gymId, type);
  // A subject is a header: never let a value smuggle in a line break.
  const subject = renderText(t.subject, vars).replace(/[\r\n]+/g, " ").trim().slice(0, EMAIL_LIMITS.subject);
  const text = renderText(t.body, vars);
  return { subject, text, html: htmlEmail({ text, type, gymName: vars.gymName, gymAddress: vars.gymAddress }) };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text to simple HTML: escaped, links clickable, line breaks kept. */
export function textToHtml(text: string): string {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}">${url}</a>`)
    .replace(/\r?\n/g, "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${body}</div>`;
}

const URL_RE = /https?:\/\/[^\s<]+/;

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${EMAIL_BRAND.text}">${linkify(escapeHtml(p.trim())).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
}

function linkify(escaped: string): string {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" style="color:${EMAIL_BRAND.link};word-break:break-all">${url}</a>`);
}

/**
 * The full HTML email: the gym's name in a header band, a heading for this kind of message, the message
 * itself, a button to its first link (when the design gives that message one), and a footer. Built from
 * tables and inline styles because email apps ignore most other CSS.
 */
/** Where the logo image is served from: the app's own public folder, since email apps block embedded images. */
export function emailLogoUrl(): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL || "https://liftmora.com").replace(/\/$/, "")}/icons/email-logo.png`;
}

export function htmlEmail(opts: { text: string; type: string; gymName: string; gymAddress: string }): string {
  const key: EmailMessageType = isEmailMessageType(opts.type) ? opts.type : "default";
  const design = EMAIL_DESIGN[key];
  const b = EMAIL_BRAND;
  const link = design.cta ? opts.text.match(URL_RE)?.[0] : undefined;
  const button = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0"><tr><td style="border-radius:8px;background:${b.accent}"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:bold;color:${b.buttonText};text-decoration:none">${escapeHtml(design.cta!)}</a></td></tr></table>`
    : "";
  const footer = [opts.gymName, opts.gymAddress].filter(Boolean).map(escapeHtml).join(" &middot; ");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(design.heading)}</title></head>
<body style="margin:0;padding:0;background:${b.pageBg};font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.pageBg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${b.cardBg};border-radius:12px;overflow:hidden">
<tr><td style="background:${b.bandBg};padding:18px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;vertical-align:middle"><img src="${escapeHtml(emailLogoUrl())}" width="32" height="32" alt="" style="display:block;border:0"></td><td style="vertical-align:middle;font-size:20px;font-weight:bold;letter-spacing:-0.3px;color:${b.bandText}">Liftmora</td></tr></table></td></tr>
<tr><td style="background:${b.accent};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px 28px">
<div style="margin:0 0 10px 0;font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${b.muted}">${escapeHtml(opts.gymName)}</div>
<h1 style="margin:0 0 20px 0;font-size:24px;line-height:1.3;color:${b.text}">${escapeHtml(design.heading)}</h1>
${paragraphs(opts.text)}${button}
</td></tr>
<tr><td style="background:${b.bandBg};padding:18px 28px;font-size:12px;line-height:1.6;color:${b.bandMuted}">${footer}<br>Sent by Liftmora on behalf of ${escapeHtml(opts.gymName)}.</td></tr>
</table></td></tr></table>
</body></html>`;
}
