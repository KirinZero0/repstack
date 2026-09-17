import crypto from "crypto";

const ALGO = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY env var not set");
  // Accept either a 32-byte base64 key or a raw passphrase (hashed to 32 bytes).
  const buf = Buffer.from(key, "base64");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(key).digest();
}

function getLookupKey(): Buffer {
  const key = process.env.LOOKUP_HMAC_KEY;
  if (!key) throw new Error("LOOKUP_HMAC_KEY env var not set");
  return Buffer.from(key, "utf8");
}

/** Encrypts a UTF-8 string with AES-256-GCM. Output: "v1:<base64(iv|tag|ciphertext)>". */
export function encrypt(plain: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ciphertext]);
  return `v1:${payload.toString("base64")}`;
}

/** Decrypts a value produced by encrypt(). Throws if the version prefix is unrecognized. */
export function decrypt(ciphertext: string): string {
  const [version, b64] = ciphertext.split(":");
  if (version !== "v1" || !b64) throw new Error(`Unsupported ciphertext version: ${version}`);
  const key = getEncryptionKey();
  const payload = Buffer.from(b64, "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const data = payload.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString("utf8");
}

/** Normalizes a phone number to digits-only (E.164-ish, no leading "+"). */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/** HMAC-SHA256 blind index of a normalized phone number, for exact-match lookups. */
export function hmacLookup(value: string): string {
  const key = getLookupKey();
  return crypto.createHmac("sha256", key).update(normalizePhone(value)).digest("hex");
}

/** Masks a phone number for list views, e.g. "+62•••••1234". */
export function maskPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length <= 4) return "•".repeat(digits.length);
  return `+${digits.slice(0, 2)}${"•".repeat(5)}${digits.slice(-4)}`;
}

/** Masks an email for list views, e.g. "a•••@example.com". */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "•".repeat(email.length);
  const visible = user.slice(0, 1);
  return `${visible}${"•".repeat(Math.max(user.length - 1, 2))}@${domain}`;
}
