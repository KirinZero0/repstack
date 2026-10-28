import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { emailTemplateSchema } from "@/lib/validation/tenant";
import { isEmailMessageType, templateError } from "@/lib/emailTemplates";

/** The owner writes (or resets) one of their gym's email templates. Staff can't. */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
  if (session.role !== "OWNER") return NextResponse.json({ error: "Only the owner can change email templates" }, { status: 403 });

  const parsed = emailTemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const input = parsed.data;
  if (!isEmailMessageType(input.type)) return NextResponse.json({ error: "Unknown email type" }, { status: 400 });

  // Tenant isolation: the gym comes from the session, never from the request.
  if ("reset" in input) {
    await db.emailTemplate.deleteMany({ where: { gymId: gym.id, type: input.type } });
    return NextResponse.json({ ok: true });
  }
  const problem = templateError(input);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  await db.emailTemplate.upsert({
    where: { gymId_type: { gymId: gym.id, type: input.type } },
    create: { gymId: gym.id, type: input.type, subject: input.subject, body: input.body },
    update: { subject: input.subject, body: input.body },
  });
  return NextResponse.json({ ok: true });
}
