-- AlterTable
ALTER TABLE "Gym" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GymSignup" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "frozenAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MemberSignup" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PlatformPayment" ADD COLUMN     "invoiceUrl" TEXT;
