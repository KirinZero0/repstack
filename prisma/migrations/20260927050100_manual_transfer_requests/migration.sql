-- AlterTable
ALTER TABLE "Gym" ADD COLUMN     "bankAccountHolder" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT;

-- AlterTable
ALTER TABLE "MemberSignup" ADD COLUMN     "proofImageUrl" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';
