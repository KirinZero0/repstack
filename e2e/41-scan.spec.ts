import fs from "fs";
import os from "os";
import path from "path";
import QRCode from "qrcode";
import { test, expect, chromium } from "@playwright/test";
import { prisma, buildTokenForMember } from "./helpers";
import { buildQrToken, verifyQrToken, parseQrToken, buildLegacyQrToken } from "../src/lib/qr";

/** Writes a looping Y4M camera feed showing `text` as a QR code — what Chromium's fake camera plays. */
function writeQrVideo(text: string, file: string) {
  const W = 640;
  const H = 480;
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 4;
  const cell = Math.floor(Math.min(W, H) / (n + quiet * 2));
  const side = cell * (n + quiet * 2);
  const x0 = Math.floor((W - side) / 2);
  const y0 = Math.floor((H - side) / 2);
  const y = Buffer.alloc(W * H, 255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let dy = 0; dy < cell; dy++) {
        const row = y0 + (quiet + r) * cell + dy;
        const start = row * W + x0 + (quiet + c) * cell;
        y.fill(0, start, start + cell);
      }
    }
  }
  const chroma = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`);
  fs.writeFileSync(file, Buffer.concat([header, ...Array(5).fill(frame)]));
}

async function scanWithFakeCamera(token: string, ip: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakecam-"));
  const video = path.join(dir, "qr.y4m");
  writeQrVideo(token, video);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
  const context = await browser.newContext({
    permissions: ["camera"],
    extraHTTPHeaders: { "x-forwarded-for": ip },
  });
  const page = await context.newPage();
  const base = "http://localhost:3100";
  await page.goto(`${base}/test-gym-a/login`);
  await page.getByLabel("Email").fill("owner-a@test.local");
  await page.getByLabel("Password").fill("owner-pass-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${base}/test-gym-a/dashboard`);
  await page.goto(`${base}/test-gym-a/checkin`);
  return { page, browser };
}

test("the real scanner reads a member's compact QR from a camera feed", async () => {
  test.setTimeout(60_000);
  const member = await prisma.member.findUniqueOrThrow({ where: { email: "active-member@test.local" } });
  await prisma.checkIn.deleteMany({ where: { memberId: member.id } });
  const token = await buildTokenForMember(member.id);
  const { page, browser } = await scanWithFakeCamera(token, "10.41.0.1");
  try {
    await expect(page.getByText("Checked in")).toBeVisible({ timeout: 20_000 });
    const row = await prisma.checkIn.findFirstOrThrow({
      where: { memberId: member.id },
      orderBy: { checkedInAt: "desc" },
    });
    expect(row.result).toBe("SUCCESS");
  } finally {
    await browser.close();
  }
});

test("the real scanner rejects a code that is not ours", async () => {
  test.setTimeout(60_000);
  const { page, browser } = await scanWithFakeCamera("m1.not-a-real-liftmora-code-0123456789abcdefghijklmnopqrstuv", "10.41.0.2");
  try {
    await expect(page.getByText("Invalid QR code")).toBeVisible({ timeout: 20_000 });
  } finally {
    await browser.close();
  }
});

test("compact member tokens stay small, verify, reject tampering and legacy tokens still work", async () => {
  const member = await prisma.member.findUniqueOrThrow({ where: { email: "active-member@test.local" } });
  const payload = { gymId: member.gymId, memberId: member.id, issuedAt: Date.now() };

  const compact = buildQrToken(payload, member.qrSecret);
  expect(compact.length).toBeLessThanOrEqual(70);
  const parsed = parseQrToken(compact)!;
  expect(parsed.memberId).toBe(member.id);
  expect(verifyQrToken(compact, member.qrSecret)?.memberId).toBe(member.id);
  expect(verifyQrToken(compact, "another-secret")).toBeNull();

  const flipped = compact.slice(0, -2) + (compact.endsWith("AA") ? "BB" : "AA");
  expect(verifyQrToken(flipped, member.qrSecret)).toBeNull();

  const legacy = buildLegacyQrToken(payload, member.qrSecret);
  expect(verifyQrToken(legacy, member.qrSecret)?.memberId).toBe(member.id);
  expect(parseQrToken(legacy)!.memberId).toBe(member.id);
});
