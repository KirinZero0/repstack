-- AlterTable: optional features a superadmin grants a gym, e.g. {"fieldBooking": true}. Empty = none granted.
ALTER TABLE "Gym" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';
