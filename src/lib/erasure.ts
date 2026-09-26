import crypto from "crypto";
import { del } from "@vercel/blob";
import { prisma } from "./prisma";
import { encrypt } from "./crypto";

/**
 * Erases a member's personal data but keeps the row, so payment and check-in history still add up.
 * Name, email, phone, password, photo, QR secret and any sign-up/reset records are wiped, the account
 * is cancelled, and the email becomes free to register again.
 *
 * Runs as the system client (it has to clear tables the gym role can't touch), so callers must have
 * already checked that the member belongs to the session's gym.
 */
export async function eraseMember(memberId: string): Promise<boolean> {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member || member.anonymizedAt) return false;

  await prisma.$transaction([
    prisma.member.update({
      where: { id: member.id },
      data: {
        fullName: "Erased member",
        email: `erased-${member.id}@erased.invalid`,
        phoneWhatsapp: encrypt("erased"),
        phoneWhatsappLookup: `erased:${member.id}`,
        passwordHash: null,
        photoUrl: null,
        qrSecret: crypto.randomUUID(),
        status: "CANCELLED",
        frozenAt: null,
        anonymizedAt: new Date(),
      },
    }),
    prisma.magicLink.deleteMany({ where: { memberId: member.id } }),
    prisma.passwordReset.deleteMany({ where: { kind: "member", subjectId: member.id } }),
    // The join request holds the same name, email, phone and password hash.
    prisma.memberSignup.deleteMany({ where: { OR: [{ memberId: member.id }, { email: member.email }] } }),
  ]);

  if (member.photoUrl && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(member.photoUrl).catch((err) => console.error("Could not delete an erased member's photo", err));
  }
  return true;
}
