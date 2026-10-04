import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { extendedExpiry } from "@/lib/membership";
import { countMemberSeats, memberLimitMessage } from "@/lib/limits";
import { createMember, isUniqueViolation } from "@/lib/members";
import { MAX_IMPORT_ROWS, parseMemberSheet, type ParsedRow } from "@/lib/memberImport";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ImportRowResult {
  line: number;
  fullName: string;
  email: string;
  phone: string;
  plan: string;
  expiry: string | null;
  /** ok = will be / was created; skipped = already a member here; error = needs fixing in the sheet. */
  outcome: "ok" | "skipped" | "error";
  reason?: string;
}

/**
 * Bulk-adds members from a CSV (the gym's old spreadsheet, or a Repstack export). Multipart form:
 * `file`, `planId` (used for rows with no Plan, or when the sheet has no Plan column), `notify`
 * ("1" sends activation links, "0" doesn't) and `dryRun` ("1" validates and reports, creates nothing).
 *
 * Owner only, like export. Imported members get no CASH payment record: they paid before the gym
 * used Repstack, so booking the plan price today would invent revenue. A past "Paid until" makes
 * the member EXPIRED rather than ACTIVE, so the roster is honest from the first day.
 */
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
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can import members" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a CSV file to import" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "The file must be under 2MB" }, { status: 400 });
  }
  const dryRun = form?.get("dryRun") === "1";
  const notify = form?.get("notify") !== "0";
  const defaultPlanId = typeof form?.get("planId") === "string" ? (form!.get("planId") as string) : "";

  const text = await file.text();
  const sheet = parseMemberSheet(text);
  if (sheet.missingColumns.length > 0) {
    return NextResponse.json(
      { error: `The file needs these columns: ${sheet.missingColumns.join(", ")}. Found: ${sheet.unknownColumns.join(", ") || "none recognised"}.` },
      { status: 400 },
    );
  }
  if (sheet.rows.length === 0) {
    return NextResponse.json({ error: "The file has a header but no member rows" }, { status: 400 });
  }

  const plans = await db.membershipPlan.findMany({ where: { gymId: gym.id, isActive: true } });
  const planByName = new Map(plans.map((p) => [p.name.trim().toLowerCase(), p]));
  const defaultPlan = plans.find((p) => p.id === defaultPlanId) ?? null;
  const needsDefault = sheet.rows.some((r) => !r.error && !r.plan);
  if (needsDefault && !defaultPlan) {
    return NextResponse.json({ error: "Some rows have no plan. Choose a default plan for them." }, { status: 400 });
  }

  // Emails already at this gym are skipped rather than failed: re-importing an export is a no-op.
  const emails = sheet.rows.filter((r) => !r.error).map((r) => r.email);
  const existing = new Set(
    (await db.member.findMany({ where: { gymId: gym.id, email: { in: emails } }, select: { email: true } })).map((m) => m.email.toLowerCase()),
  );

  const saasPlan = await db.saasPlan.findUnique({ where: { id: gym.saasPlanId } });
  const seats = await countMemberSeats(db, gym.id);
  let remaining = saasPlan ? saasPlan.maxMembers - seats : Number.POSITIVE_INFINITY;

  const results: ImportRowResult[] = [];
  const toCreate: { row: ParsedRow; planId: string; membershipExpiry: Date; status: "ACTIVE" | "EXPIRED" }[] = [];
  const now = new Date();
  for (const row of sheet.rows) {
    const base = { line: row.line, fullName: row.fullName, email: row.email, phone: row.phone, plan: row.plan, expiry: row.expiry };
    if (row.error) {
      results.push({ ...base, outcome: "error", reason: row.error });
      continue;
    }
    if (existing.has(row.email.toLowerCase())) {
      results.push({ ...base, outcome: "skipped", reason: "Already a member here" });
      continue;
    }
    const plan = row.plan ? planByName.get(row.plan.toLowerCase()) : defaultPlan;
    if (!plan) {
      results.push({ ...base, outcome: "error", reason: `No active plan called "${row.plan}" (have: ${plans.map((p) => p.name).join(", ")})` });
      continue;
    }
    if (remaining <= 0) {
      results.push({ ...base, outcome: "error", reason: saasPlan ? memberLimitMessage(saasPlan.name, saasPlan.maxMembers) : "Over the member limit" });
      continue;
    }
    remaining--;
    const membershipExpiry = row.expiry ? new Date(`${row.expiry}T23:59:59Z`) : extendedExpiry(null, plan.durationDays, now);
    toCreate.push({ row, planId: plan.id, membershipExpiry, status: membershipExpiry < now ? "EXPIRED" : "ACTIVE" });
    results.push({ ...base, plan: plan.name, outcome: "ok" });
  }

  const summary = () => ({
    total: results.length,
    ok: results.filter((r) => r.outcome === "ok").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    errors: results.filter((r) => r.outcome === "error").length,
    truncated: sheet.rows.length >= MAX_IMPORT_ROWS,
  });

  if (dryRun) {
    return NextResponse.json({ dryRun: true, rows: results, summary: summary(), unknownColumns: sheet.unknownColumns });
  }

  // Row by row, not one transaction: each member gets an activation link and (optionally) a
  // message, and a bad row late in the file shouldn't undo the hundred good ones before it.
  let created = 0;
  for (const item of toCreate) {
    const result = results.find((r) => r.line === item.row.line)!;
    try {
      await createMember(
        db,
        gym,
        { fullName: item.row.fullName, email: item.row.email, phoneWhatsapp: item.row.phone, planId: item.planId, membershipExpiry: item.membershipExpiry, status: item.status },
        { recordPayment: null, notify },
      );
      created++;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // The email exists at another gym: the tenant-scoped check above can't see it, the unique index can.
        result.outcome = "error";
        result.reason = "Unable to add member with this email";
      } else {
        console.error(`Member import failed at line ${item.row.line}`, err);
        result.outcome = "error";
        result.reason = "Something went wrong saving this row";
      }
    }
  }

  return NextResponse.json({ dryRun: false, created, rows: results, summary: summary(), unknownColumns: sheet.unknownColumns });
}
