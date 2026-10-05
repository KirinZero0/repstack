-- AlterTable
ALTER TABLE "ClassRegistration" ADD COLUMN     "attendance" TEXT,
ADD COLUMN     "attendanceAt" TIMESTAMP(3),
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MemberSignup" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'JOIN',
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "checkedOutAt" TIMESTAMP(3);
