import { NextRequest, NextResponse } from "next/server";
import { resetPasswordSchema } from "@/lib/validation/tenant";
import { applyPasswordReset, describeReset } from "@/lib/passwordReset";

/** What is this link for? Returns only a first name and the gym, and nothing if the link is dead. */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const info = await describeReset(params.token);
  if (!info) return NextResponse.json({ error: "This link is invalid, expired or already used." }, { status: 404 });
  return NextResponse.json({ purpose: info.purpose, name: info.name.split(" ")[0], gymName: info.gymName });
}

/** Sets the new password. The link works once. */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const parsed = resetPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Your password must be at least 8 characters." }, { status: 400 });
  }
  const result = await applyPasswordReset(params.token, parsed.data.password);
  if (!result) return NextResponse.json({ error: "This link is invalid, expired or already used." }, { status: 404 });
  return NextResponse.json({ ok: true, loginUrl: `/${result.gymSlug}/login` });
}
