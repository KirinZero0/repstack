"use client";

export interface BankInfo {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

export const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/**
 * "Transfer this amount here, then attach your proof": shown wherever someone pays a gym by bank
 * transfer. With no bank details on file it says to pay at the front desk instead. Staff check the
 * money before confirming, so the proof image is optional.
 */
export default function TransferPayment({
  amount,
  bank,
  onProof,
  proofHint = "Staff check the transfer before approving. A screenshot speeds it up.",
}: {
  amount: number;
  bank: BankInfo | null;
  onProof: (file: File | null) => void;
  proofHint?: string;
}) {
  if (amount <= 0) return null;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm" data-testid="transfer-payment">
      <p className="font-medium text-white">Pay {rupiah(amount)}</p>
      {bank ? (
        <>
          <p className="mt-2 text-neutral-300">
            Transfer to <strong>{bank.bankName}</strong> <span className="font-mono">{bank.accountNumber}</span>
            {bank.accountHolder ? ` (${bank.accountHolder})` : ""}.
          </p>
          <label className="mt-3 block text-neutral-300">
            <span className="mb-1 block">Proof of transfer (optional)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => onProof(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-neutral-400 file:mr-3 file:rounded-md file:border file:border-neutral-700 file:bg-neutral-950 file:px-3 file:py-1.5 file:text-white"
            />
            <span className="mt-1 block text-xs text-neutral-500">{proofHint}</span>
          </label>
        </>
      ) : (
        <p className="mt-2 text-neutral-400">This gym takes payment at the front desk.</p>
      )}
    </div>
  );
}
