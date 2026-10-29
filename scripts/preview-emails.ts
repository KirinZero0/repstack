/**
 * Writes every member email as an HTML file you can open in a browser, using the platform's default
 * wording and realistic sample messages.
 *
 *   npx tsx scripts/preview-emails.ts [outputDir]
 *
 * The logo is normally loaded from the app's URL, which doesn't exist when you open a file from disk, so
 * the previews embed it instead.
 */
import fs from "fs";
import path from "path";
import { EMAIL_MESSAGE_TYPES, SYSTEM_EMAIL_TYPES, type EmailMessageType, type SystemEmailType } from "../src/config/email";
import { renderEmail } from "../src/lib/emailTemplates";

const gymName = "Iron Ledger Gym";
const gymAddress = "Jl. Sudirman No. 12, Jakarta";
const memberName = "Sari Wijaya";
const app = "https://liftmora.com";

/** What each message says once the system has filled in the dates, amounts and links (as sent on WhatsApp). */
const SAMPLE_MESSAGES: Record<EmailMessageType | SystemEmailType, string> = {
  default: `Hi ${memberName}, we have an update for you from ${gymName}.`,
  member_activation: `Hi ${memberName}! You've been added to ${gymName}.\nYour membership is active until 26/11/2026.\nSet your password and see your check-in QR here: ${app}/activate/3f9c2a7e5b1d4c8e9a60`,
  member_welcome: `Welcome to ${gymName}, ${memberName}! Your Monthly membership is active until 26/11/2026. Log in with sari@example.com at ${app}/iron-ledger/login to see your check-in QR.`,
  renewal_confirmed: `Hi ${memberName}, ${gymName} confirmed your transfer. Your Monthly membership is now active until 26/12/2026. See you at the gym!`,
  payment_receipt: `Hi ${memberName}, we received your payment of Rp 250.000 for Monthly at ${gymName}. Your membership is active until 26/11/2026. Thank you!`,
  expiry_reminder: `Hi ${memberName}, your gym membership expires on 29/10/2026. Renew soon to keep your access active.`,
  expired_notice: `Hi ${memberName}, your gym membership has expired. Renew to regain access.`,
  manual_reminder: `Hi ${memberName}, your ${gymName} membership is waiting for payment. Please pay to activate it.`,
  password_reset: `Hi ${memberName}, use this link to set a new password for ${gymName}: ${app}/reset/8d1e47c2a9b34f05b6e1 (valid 1 hour). If you didn't ask for this, ignore it.`,
  qr_fallback: `Hi ${memberName}, here's your gym QR code link (no login needed, valid 24h): ${app}/my-qr?token=b7a09d3c61f84e2a95d0`,
  class_confirmation: `Hi ${memberName}, you're booked for Morning Yoga at ${gymName} on Sat, 31 Oct, 07:00 with Dewi. See you there!`,
  class_reminder: `Reminder: Morning Yoga at ${gymName} is on Sat, 31 Oct, 07:00. See you there!`,
  gym_welcome: `Welcome to Liftmora, ${memberName}! "${gymName}" is ready. Log in at ${app}/iron-ledger/login with sari@example.com and the password you chose. You have a free 14-day trial.`,
  subscription_due: `Your Liftmora subscription for "${gymName}" is due. Pay by bank transfer and upload the proof here: ${app}/iron-ledger/billing. Please pay before 29/10/2026, or the gym will be suspended.`,
  subscription_paid: `Hi ${memberName}, we received your payment of Rp 300.000 for Starter Monthly. ${gymName} is covered until 26/11/2026. Thank you!`,
  gym_suspended: `Your Liftmora subscription for "${gymName}" was not paid, so the gym is suspended: staff and members can't log in or check in. Pay here to switch it back on right away: ${app}/iron-ledger/billing`,
  staff_invite: `Hi ${memberName}, you've been added to ${gymName} on Liftmora. Set your password here: ${app}/reset/5c2e9a7d1b8f46039e1a (valid 7 days)`,
  staff_password_reset: `Hi ${memberName}, use this link to set a new password for ${gymName}: ${app}/reset/a91d3e6f0c7b42158d2e (valid 1 hour). If you didn't ask for this, ignore it.`,
  class_cancelled: `Hi ${memberName}, Morning Yoga at ${gymName} on Sat, 31 Oct, 07:00 has been cancelled. Sorry for the inconvenience.`,
  guest_ticket: `Hi ${memberName}, you're approved for Day pass (Daily Pass) at ${gymName}, valid until Kamis, 26 November. Show this one-time QR ticket at the front desk: ${app}/ticket/ticket.eyJneW1JZCI6IjEifQ.4f2a`,
  guest_rejected: `Hi ${memberName}, sorry — we couldn't confirm your Day pass (Daily Pass). Please contact the front desk.`,
};

/** Swaps each image URL (logo, badge) for the file itself so the page works from disk. */
const inlineImages = (html: string) =>
  html.replace(/src="[^"]*\/(icons\/email-logo|email\/[a-z_]+)\.png"/g, (_, rel: string) => `src="data:image/png;base64,${fs.readFileSync(path.resolve("public", `${rel}.png`)).toString("base64")}"`);
const out = path.resolve(process.argv[2] ?? "email-previews");
fs.mkdirSync(out, { recursive: true });
const index: { type: string; label: string; subject: string; file: string }[] = [];
for (const type of [...Object.keys(EMAIL_MESSAGE_TYPES), ...Object.keys(SYSTEM_EMAIL_TYPES)] as (EmailMessageType | SystemEmailType)[]) {
  const email = renderEmail([], null, type, { gymName, gymAddress, memberName, message: SAMPLE_MESSAGES[type] });
  const file = `${type}.html`;
  fs.writeFileSync(path.join(out, file), inlineImages(email.html));
  index.push({ type, label: type in SYSTEM_EMAIL_TYPES ? `Liftmora to gym: ${SYSTEM_EMAIL_TYPES[type as SystemEmailType]}` : EMAIL_MESSAGE_TYPES[type as EmailMessageType], subject: email.subject, file });
}
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 2));
console.log(`Wrote ${index.length} emails to ${out}`);
