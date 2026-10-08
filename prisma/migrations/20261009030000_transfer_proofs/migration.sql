-- AlterTable: bank-transfer proof for guest tickets and member class bookings
ALTER TABLE "GuestPass" ADD COLUMN "proofImageUrl" TEXT, ADD COLUMN "proofSubmittedAt" TIMESTAMP(3);
ALTER TABLE "ClassRegistration" ADD COLUMN "proofImageUrl" TEXT, ADD COLUMN "proofSubmittedAt" TIMESTAMP(3);

-- Class guest tickets now carry the class price too (nothing to backfill: earlier ones were free of charge)
