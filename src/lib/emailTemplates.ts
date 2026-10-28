import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_LIMITS,
  EMAIL_MESSAGE_TYPES,
  EMAIL_PLACEHOLDERS,
  type EmailMessageType,
  type EmailTemplate,
} from "@/config/email";

export type EmailVars = Record<keyof typeof EMAIL_PLACEHOLDERS, string>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export function isEmailMessageType(type: string): type is EmailMessageType {
  return type in EMAIL_MESSAGE_TYPES;
}

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
  return { subject, text, html: textToHtml(text) };
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
