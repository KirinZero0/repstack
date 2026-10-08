-- CreateEnum
CREATE TYPE "GuestPassStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ATTENDED');

-- AlterTable: guest tickets send WhatsApp to people who are not members
ALTER TABLE "NotificationLog" ALTER COLUMN "memberId" DROP NOT NULL;
ALTER TABLE "NotificationLog" DROP CONSTRAINT "NotificationLog_memberId_fkey";
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "GuestPass" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneWhatsapp" TEXT NOT NULL,
    "phoneWhatsappLookup" TEXT NOT NULL,
    "ticketSecret" TEXT NOT NULL,
    "status" "GuestPassStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "ipHash" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "attendedAt" TIMESTAMP(3),
    "scannedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestPass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestPass_sessionId_phoneWhatsappLookup_key" ON "GuestPass"("sessionId", "phoneWhatsappLookup");
CREATE INDEX "GuestPass_gymId_status_idx" ON "GuestPass"("gymId", "status");
CREATE INDEX "GuestPass_ipHash_createdAt_idx" ON "GuestPass"("ipHash", "createdAt");

-- AddForeignKey
ALTER TABLE "GuestPass" ADD CONSTRAINT "GuestPass_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuestPass" ADD CONSTRAINT "GuestPass_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuestPass" ADD CONSTRAINT "GuestPass_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuestPass" ADD CONSTRAINT "GuestPass_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
