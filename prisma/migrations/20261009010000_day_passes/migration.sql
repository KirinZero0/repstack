-- CreateTable
CREATE TABLE "DayPassPlan" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayPassPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DayPassPlan_gymId_idx" ON "DayPassPlan"("gymId");
ALTER TABLE "DayPassPlan" ADD CONSTRAINT "DayPassPlan_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: a guest pass is for a class session OR a day pass
ALTER TABLE "GuestPass" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "GuestPass" ADD COLUMN "dayPassPlanId" TEXT, ADD COLUMN "visitDate" TEXT;
ALTER TABLE "GuestPass" DROP CONSTRAINT "GuestPass_sessionId_fkey";
ALTER TABLE "GuestPass" ADD CONSTRAINT "GuestPass_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuestPass" ADD CONSTRAINT "GuestPass_dayPassPlanId_fkey" FOREIGN KEY ("dayPassPlanId") REFERENCES "DayPassPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuestPass" ADD CONSTRAINT "GuestPass_one_target" CHECK (("sessionId" IS NOT NULL) <> ("dayPassPlanId" IS NOT NULL));
CREATE UNIQUE INDEX "GuestPass_dayPassPlanId_visitDate_phoneWhatsappLookup_key" ON "GuestPass"("dayPassPlanId", "visitDate", "phoneWhatsappLookup");
