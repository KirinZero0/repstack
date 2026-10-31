-- AlterTable: mark a gym as a test gym (excluded from platform totals and billing, no automatic messages)
ALTER TABLE "Gym" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
