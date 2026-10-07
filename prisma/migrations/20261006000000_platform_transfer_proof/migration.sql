-- AlterTable
ALTER TABLE "PlatformPayment" ADD COLUMN     "proofImageUrl" TEXT,
ADD COLUMN     "proofSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "senderName" TEXT,
ADD COLUMN     "transferDate" TEXT,
ADD COLUMN     "rejectionReason" TEXT;
