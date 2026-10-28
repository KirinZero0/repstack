/**
 * Renders the Liftmora plate mark into the PNG icons the web app manifest needs.
 *
 *   node scripts/make-pwa-icons.mjs
 *
 * Also writes email-logo.png, the mark on a transparent background for emails. Output goes to public/icons and is committed, so this only needs re-running if the mark changes.
 * Uses Playwright's Chromium; set CHROMIUM_PATH if the browser lives somewhere unusual.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BG = "#0c1014";
const YELLOW = "#e8b923";
const OUT = path.resolve("public/icons");

// `scale` is how much of the square the mark fills. Maskable icons get cropped to a circle or squircle
// by the OS, so their mark stays inside the central ~60% "safe zone".
const ICONS = [
  { file: "icon-192.png", size: 192, scale: 0.78 },
  { file: "icon-512.png", size: 512, scale: 0.78 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.56 },
  { file: "apple-touch-icon.png", size: 180, scale: 0.7 },
];

const mark = (size, scale) => {
  const d = size * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="14" stroke="${YELLOW}" stroke-width="4"/>
    <circle cx="16" cy="16" r="4" stroke="${YELLOW}" stroke-width="2.5"/></svg>`;
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const { file, size, scale } of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<body style="margin:0;background:${BG};width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${mark(size, scale)}</body>`,
  );
  await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log("wrote", file);
}

// The mark on a transparent background for the email header (which is dark), drawn at 2x for sharp screens.
{
  const size = 96;
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;background:transparent">${mark(size, 1)}</body>`);
  await page.screenshot({ path: path.join(OUT, "email-logo.png"), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log("wrote email-logo.png");
}
await browser.close();
