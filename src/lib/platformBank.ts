import { prisma } from "./prisma";
import { isMockMode, onlinePaymentsEnabled } from "./gateway";

const BANK_KEY = "platform.bank";

export type PlatformBank = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
};

/**
 * Until a payment provider is approved, gyms pay their Liftmora subscription by bank transfer to the
 * platform's account and the superadmin confirms it by hand. Online payments (or dev mock mode) take over
 * the moment they're switched on, so this flow disappears without any other change.
 */
export function manualPlatformBilling(): boolean {
  return !onlinePaymentsEnabled() && !isMockMode();
}

export async function getPlatformBank(): Promise<PlatformBank | null> {
  const row = await prisma.appConfig.findUnique({ where: { key: BANK_KEY } });
  const v = row?.value as Partial<PlatformBank> | null | undefined;
  if (!v?.bankName || !v.accountNumber || !v.accountHolder) return null;
  return { bankName: v.bankName, accountNumber: v.accountNumber, accountHolder: v.accountHolder };
}

export async function setPlatformBank(bank: PlatformBank) {
  await prisma.appConfig.upsert({ where: { key: BANK_KEY }, create: { key: BANK_KEY, value: bank }, update: { value: bank } });
}

/** Short code the owner puts in the transfer note so the superadmin can match it to the invoice. */
export function transferReference(paymentId: string): string {
  return `RS-${paymentId.slice(0, 8).toUpperCase()}`;
}
