-- AlterTable: per-person fields can require a minimum number of people per booking
ALTER TABLE "Field" ADD COLUMN "minPax" INTEGER;
