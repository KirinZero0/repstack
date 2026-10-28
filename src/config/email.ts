/**
 * Everything about member emails that is configuration rather than code: which messages exist, what
 * each is called, the placeholders a template may use, and the default wording. A gym overrides any
 * of this from Settings (stored in `Gym.settings.emailTemplates`); nothing here is gym-specific.
 */

export interface EmailTemplate {
  subject: string;
  body: string;
}

/** Placeholders a template may use, as `{{name}}`. */
export const EMAIL_PLACEHOLDERS = {
  gymName: "Your gym's name",
  memberName: "The member's full name",
  gymAddress: "Your gym's address (empty if not set)",
  message: "The text of this message: the dates, amounts and links the system fills in",
} as const;

export type EmailPlaceholder = keyof typeof EMAIL_PLACEHOLDERS;

/**
 * Every kind of message the system sends to a member or guest, over WhatsApp or email. This list mirrors
 * the `MessageType` enum in prisma/schema.prisma (a test keeps them identical); `default` is not a
 * message but the "everything else" template.
 */
export const MESSAGE_TYPES = [
  "default",
  "member_activation",
  "member_welcome",
  "renewal_confirmed",
  "payment_receipt",
  "expiry_reminder",
  "expired_notice",
  "manual_reminder",
  "password_reset",
  "qr_fallback",
  "class_confirmation",
  "class_reminder",
  "class_cancelled",
  "guest_ticket",
  "guest_rejected",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

/** A message that is actually sent (not the `default` template slot). */
export type NotificationType = Exclude<MessageType, "default">;

/** Guests give a WhatsApp number but no email, so these two are WhatsApp-only. */
const WHATSAPP_ONLY: readonly MessageType[] = ["guest_ticket", "guest_rejected"];

/** Message types a gym can write an email for, with the label the editor shows. */
export const EMAIL_MESSAGE_TYPES = {
  default: "Everything else (used when a message has no template of its own)",
  member_activation: "Activation link",
  member_welcome: "Welcome",
  renewal_confirmed: "Membership renewed",
  payment_receipt: "Payment receipt",
  expiry_reminder: "Expiry reminder",
  expired_notice: "Membership expired",
  manual_reminder: "Reminder sent by staff",
  password_reset: "Password reset",
  qr_fallback: "Check-in QR link",
  class_confirmation: "Class booking",
  class_reminder: "Class reminder",
  class_cancelled: "Class cancelled",
} as const satisfies Partial<Record<MessageType, string>>;

export type EmailMessageType = keyof typeof EMAIL_MESSAGE_TYPES;

export function isEmailMessageType(type: string): type is EmailMessageType {
  return type in EMAIL_MESSAGE_TYPES && !WHATSAPP_ONLY.includes(type as MessageType);
}

export const EMAIL_LIMITS = { subject: 150, body: 5000 } as const;

/**
 * Wording a gym gets until it writes its own. `{{message}}` is the message exactly as it would go out
 * on WhatsApp, so every message type works without its own template.
 */
export const DEFAULT_EMAIL_TEMPLATES: Record<EmailMessageType, EmailTemplate> = {
  default: { subject: "{{gymName}}", body: "{{message}}" },
  member_activation: { subject: "{{gymName}}: Activate your account", body: "{{message}}" },
  member_welcome: { subject: "{{gymName}}: Welcome", body: "{{message}}" },
  payment_receipt: { subject: "{{gymName}}: Payment received", body: "{{message}}" },
  expiry_reminder: { subject: "{{gymName}}: Your membership is expiring soon", body: "{{message}}" },
  expired_notice: { subject: "{{gymName}}: Your membership has expired", body: "{{message}}" },
  manual_reminder: { subject: "{{gymName}}: A message from your gym", body: "{{message}}" },
  password_reset: { subject: "{{gymName}}: Reset your password", body: "{{message}}" },
  qr_fallback: { subject: "{{gymName}}: Your check-in QR link", body: "{{message}}" },
  class_confirmation: { subject: "{{gymName}}: Your class booking", body: "{{message}}" },
  class_reminder: { subject: "{{gymName}}: Your class is tomorrow", body: "{{message}}" },
  class_cancelled: { subject: "{{gymName}}: A class was cancelled", body: "{{message}}" },
  renewal_confirmed: { subject: "{{gymName}}: Membership renewed", body: "{{message}}" },
};

/** How the HTML version of each email looks: Liftmora's black and plate yellow. */
export const EMAIL_BRAND = {
  /** Header and footer bands. */
  bandBg: "#0c1014",
  bandText: "#ffffff",
  bandMuted: "#9aa4ae",
  /** The plate yellow: the stripe under the header and the call-to-action button (dark text on it). */
  accent: "#e8b923",
  buttonText: "#0c1014",
  /** Links in the body. Yellow itself is too faint on white, so they use a deep gold. */
  link: "#8a6a00",
  pageBg: "#eceef0",
  cardBg: "#ffffff",
  text: "#0c1014",
  muted: "#5b6670",
} as const;

/**
 * A big heading for each message and, where the message carries a link, the label on the button that opens
 * it. The button goes to the first link found in the message, so a message with no link gets no button.
 */
export const EMAIL_DESIGN: Record<EmailMessageType, { heading: string; cta?: string }> = {
  default: { heading: "A message from your gym" },
  member_activation: { heading: "Welcome! Set up your account", cta: "Set your password" },
  member_welcome: { heading: "You're in. Welcome!", cta: "Log in to see your QR" },
  renewal_confirmed: { heading: "Your membership is renewed", cta: "Log in to see your QR" },
  payment_receipt: { heading: "Payment received" },
  expiry_reminder: { heading: "Your membership is expiring soon" },
  expired_notice: { heading: "Your membership has expired" },
  manual_reminder: { heading: "A reminder from your gym" },
  password_reset: { heading: "Reset your password", cta: "Choose a new password" },
  qr_fallback: { heading: "Your check-in QR", cta: "Show my QR" },
  class_confirmation: { heading: "You're booked" },
  class_reminder: { heading: "Your class is coming up" },
  class_cancelled: { heading: "A class was cancelled" },
};
