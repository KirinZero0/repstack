import type { PrismaClient } from "@prisma/client";
import { DEFAULT_EMAIL_TEMPLATES, DEFAULT_SYSTEM_EMAIL_TEMPLATES } from "../src/config/email";

/**
 * Writes the platform's default email templates (rows with no gym) from the wording built into the app.
 * Every gym falls back to these. A type that already has a platform row is left alone, so edits made in the
 * database survive; pass `overwrite` to put the built-in wording back over all of them.
 */
export async function seedEmailTemplates(
  prisma: PrismaClient,
  opts: { overwrite?: boolean } = {},
): Promise<{ created: string[]; updated: string[]; kept: string[] }> {
  const defaults = { ...DEFAULT_EMAIL_TEMPLATES, ...DEFAULT_SYSTEM_EMAIL_TEMPLATES };
  const out = { created: [] as string[], updated: [] as string[], kept: [] as string[] };
  for (const [type, t] of Object.entries(defaults)) {
    const messageType = type as keyof typeof defaults;
    // A plain upsert can't match gymId = NULL, so look the row up first.
    const existing = await prisma.emailTemplate.findFirst({ where: { gymId: null, type: messageType } });
    if (!existing) {
      await prisma.emailTemplate.create({ data: { gymId: null, type: messageType, subject: t.subject, body: t.body } });
      out.created.push(type);
    } else if (opts.overwrite) {
      await prisma.emailTemplate.update({ where: { id: existing.id }, data: { subject: t.subject, body: t.body } });
      out.updated.push(type);
    } else {
      out.kept.push(type);
    }
  }
  return out;
}
