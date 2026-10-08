-- AlterTable: the price a day pass was requested at, so later price changes don't rewrite revenue
ALTER TABLE "GuestPass" ADD COLUMN "amount" DECIMAL(65,30);

-- Backfill passes requested before this column existed
UPDATE "GuestPass" g SET "amount" = p."price" FROM "DayPassPlan" p WHERE g."dayPassPlanId" = p."id";
