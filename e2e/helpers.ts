import { APIRequestContext, Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { buildQrToken } from "../src/lib/qr";
import { readXlsxRows } from "../src/lib/xlsx";

export const prisma = new PrismaClient();

export async function superadminLoginUI(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/superadmin/login`);
  await page.getByLabel("Email").fill("superadmin@test.local");
  await page.getByLabel("Password").fill("superadmin-pass-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/superadmin/dashboard`);
  await page.goto(`${baseURL}/superadmin/gyms`);
}

export async function staffLoginUI(page: Page, baseURL: string, slug: string, email: string, password: string) {
  await page.goto(`${baseURL}/${slug}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Logs in via the API and returns the session cookie header value for use with `request`. */
export async function staffLoginAPI(
  request: APIRequestContext,
  baseURL: string,
  slug: string,
  email: string,
  password: string,
) {
  const res = await request.post(`${baseURL}/api/${slug}/staff-login`, {
    data: { email, password },
  });
  if (!res.ok()) throw new Error(`staff login failed: ${res.status()} ${await res.text()}`);
  return res;
}

export async function buildTokenForMember(memberId: string) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  return buildQrToken({ gymId: member.gymId, memberId: member.id, issuedAt: Date.now() }, member.qrSecret);
}

/**
 * Splits an exported .xlsx into its parts: the grey lines above the table, the table itself (header
 * first, every cell as text: numbers plain, dates YYYY-MM-DD) and the totals block under it.
 */
export async function readExportSheet(body: Buffer) {
  const { readXlsxRows } = await import("../src/lib/xlsx");
  const all = await readXlsxRows(body);
  const blank = (r: string[]) => r.every((c) => c === "");
  const firstBlank = all.findIndex(blank);
  const info = all.slice(1, firstBlank).map((r) => r[0]);
  const headerAt = firstBlank + 1;
  let end = all.findIndex((r, i) => i > headerAt && blank(r));
  if (end === -1) end = all.length;
  const rows = all.slice(headerAt, end);
  const totals = all.slice(end).filter((r) => !blank(r));
  return { title: all[0]?.[0] ?? "", info, rows, totals };
}

/** A finance export (an .xlsx) as plain text: one line per row, cells joined by commas. */
export async function exportText(request: APIRequestContext, url: string): Promise<string> {
  const res = await request.get(url);
  if (res.status() !== 200) throw new Error(`export returned ${res.status()}`);
  return (await readXlsxRows(await res.body())).map((r) => r.join(",")).join("\n");
}
