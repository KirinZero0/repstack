-- AlterTable
ALTER TABLE "GymSignup" ADD COLUMN     "invoiceUrl" TEXT;

-- AlterTable
ALTER TABLE "MemberSignup" ADD COLUMN     "invoiceUrl" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "invoiceUrl" TEXT;
