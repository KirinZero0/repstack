import { NextResponse } from "next/server";

export const MAX_PROOF_BYTES = 2 * 1024 * 1024;
export const ALLOWED_PROOF_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The gym's bank account for transfers, or null if the owner hasn't filled it in (Settings). */
export function gymBank(gym: { bankName: string | null; bankAccountNumber: string | null; bankAccountHolder: string | null }) {
  return gym.bankName && gym.bankAccountNumber
    ? { bankName: gym.bankName, accountNumber: gym.bankAccountNumber, accountHolder: gym.bankAccountHolder ?? "" }
    : null;
}

/** Returns an error response if `file` isn't an acceptable proof image, else null. A missing/empty file is fine (proof is optional). */
export function proofFileError(file: unknown): NextResponse | null {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!ALLOWED_PROOF_MIME.has(file.type)) return NextResponse.json({ error: "Proof image must be JPEG, PNG, or WebP", field: "proof" }, { status: 400 });
  if (file.size > MAX_PROOF_BYTES) return NextResponse.json({ error: "Proof image must be under 2MB", field: "proof" }, { status: 400 });
  return null;
}
