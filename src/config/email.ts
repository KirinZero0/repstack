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
  default: { subject: "{{gymName}}", body: "{{message}}\n\n{{gymName}}" },
  member_activation: { subject: "{{gymName}}: Activate your account", body: "{{message}}\n\n{{gymName}}" },
  member_welcome: { subject: "{{gymName}}: Welcome", body: "{{message}}\n\n{{gymName}}" },
  payment_receipt: { subject: "{{gymName}}: Payment received", body: "{{message}}\n\n{{gymName}}" },
  expiry_reminder: { subject: "{{gymName}}: Your membership is expiring soon", body: "{{message}}\n\n{{gymName}}" },
  expired_notice: { subject: "{{gymName}}: Your membership has expired", body: "{{message}}\n\n{{gymName}}" },
  manual_reminder: { subject: "{{gymName}}: A message from your gym", body: "{{message}}\n\n{{gymName}}" },
  password_reset: { subject: "{{gymName}}: Reset your password", body: "{{message}}\n\n{{gymName}}" },
  qr_fallback: { subject: "{{gymName}}: Your check-in QR link", body: "{{message}}\n\n{{gymName}}" },
  class_confirmation: { subject: "{{gymName}}: Your class booking", body: "{{message}}\n\n{{gymName}}" },
  class_reminder: { subject: "{{gymName}}: Your class is tomorrow", body: "{{message}}\n\n{{gymName}}" },
  class_cancelled: { subject: "{{gymName}}: A class was cancelled", body: "{{message}}\n\n{{gymName}}" },
  renewal_confirmed: { subject: "{{gymName}}: Membership renewed", body: "{{message}}\n\n{{gymName}}" },
};
