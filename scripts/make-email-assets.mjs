/**
 * Draws the small images the HTML emails use: one yellow badge with a black glyph per kind of message.
 *
 *   node scripts/make-email-assets.mjs
 *
 * Output goes to public/email and is committed, so this only needs re-running if a glyph changes. Emails
 * load these from the app's own URL (email apps block embedded images). Uses Playwright's Chromium; set
 * CHROMIUM_PATH if the browser lives somewhere unusual.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const YELLOW = "#e8b923";
const INK = "#0c1014";
const OUT = path.resolve("public/email");
const SIZE = 112; // drawn at 2x for sharp screens; shown at 56px

// Each glyph is drawn on a 24x24 grid with a 2px round stroke.
const GLYPHS = {
  default: `<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>`,
  member_activation: `<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>`,
  member_welcome: `<path d="M5 13l4 4L19 7"/>`,
  renewal_confirmed: `<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>`,
  payment_receipt: `<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>`,
  expiry_reminder: `<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2"/><path d="M9 2h6"/>`,
  expired_notice: `<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>`,
  manual_reminder: `<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>`,
  password_reset: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
  qr_fallback: `<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h3v3h3M14 20h2M20 14v0"/>`,
  class_confirmation: `<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/>`,
  class_reminder: `<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/><circle cx="12" cy="15.5" r="2"/>`,
  gym_welcome: `<path d="M3 21h18M5 21V9l7-5 7 5v12"/><path d="M10 21v-6h4v6"/>`,
  subscription_due: `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>`,
  subscription_paid: `<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>`,
  gym_suspended: `<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>`,
  staff_invite: `<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5M19 8v6M16 11h6"/>`,
  staff_password_reset: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/><path d="M12 15v2"/>`,
  class_cancelled: `<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/><path d="M10 14l4 4M14 14l-4 4"/>`,
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [type, glyph] of Object.entries(GLYPHS)) {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  await page.setContent(
    `<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 112 112">
      <circle cx="56" cy="56" r="56" fill="${YELLOW}"/>
      <g transform="translate(28 28) scale(2.333)" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
    </svg></body>`,
  );
  await page.screenshot({ path: path.join(OUT, `${type}.png`), omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
  await page.close();
  console.log("wrote", `${type}.png`);
}
await browser.close();
