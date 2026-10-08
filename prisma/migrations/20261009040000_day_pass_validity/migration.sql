-- AlterTable: day passes are no longer tied to a chosen date; a ticket is valid for N days after approval
ALTER TABLE "DayPassPlan" ADD COLUMN "validityDays" INTEGER DEFAULT 30;
ALTER TABLE "GuestPass" ADD COLUMN "expiresAt" TIMESTAMP(3);
