-- Needed for the "same field" part of the no-overlap rule below.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'field_booking_received';
ALTER TYPE "MessageType" ADD VALUE 'field_booking_approved';
ALTER TYPE "MessageType" ADD VALUE 'field_booking_rejected';
ALTER TYPE "MessageType" ADD VALUE 'field_booking_cancelled';

-- CreateEnum
CREATE TYPE "FieldBookingStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'ATTENDED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "Field" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'Badminton',
    "pricePerHour" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "opensAt" INTEGER NOT NULL DEFAULT 480,
    "closesAt" INTEGER NOT NULL DEFAULT 1320,
    "stepMinutes" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldBooking" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneWhatsapp" TEXT NOT NULL,
    "phoneWhatsappLookup" TEXT NOT NULL,
    "email" TEXT,
    "status" "FieldBookingStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "amount" DECIMAL(65,30) NOT NULL,
    "isBlock" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "proofImageUrl" TEXT,
    "proofSubmittedAt" TIMESTAMP(3),
    "ticketSecret" TEXT NOT NULL,
    "ipHash" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "attendedAt" TIMESTAMP(3),
    "scannedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldBooking_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FieldBooking_time_check" CHECK ("endsAt" > "startsAt")
);

-- CreateIndex
CREATE INDEX "Field_gymId_idx" ON "Field"("gymId");
CREATE INDEX "FieldBooking_gymId_startsAt_idx" ON "FieldBooking"("gymId", "startsAt");
CREATE INDEX "FieldBooking_fieldId_startsAt_idx" ON "FieldBooking"("fieldId", "startsAt");
CREATE INDEX "FieldBooking_ipHash_createdAt_idx" ON "FieldBooking"("ipHash", "createdAt");

-- The rule that makes double-booking impossible: two bookings that hold time on the same field may not
-- overlap. A booking holds its time once approved, and stays holding it after the guest has come (or not);
-- pending, rejected and cancelled ones hold nothing, so several people can ask for the same hour and staff
-- pick one. The database enforces this, so it holds even for two approvals at the same instant.
ALTER TABLE "FieldBooking" ADD CONSTRAINT "FieldBooking_no_overlap"
    EXCLUDE USING gist ("fieldId" WITH =, tsrange("startsAt", "endsAt") WITH &&)
    WHERE ("status" IN ('APPROVED', 'ATTENDED', 'NO_SHOW'));

-- AddForeignKey
ALTER TABLE "Field" ADD CONSTRAINT "Field_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FieldBooking" ADD CONSTRAINT "FieldBooking_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FieldBooking" ADD CONSTRAINT "FieldBooking_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "Field"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FieldBooking" ADD CONSTRAINT "FieldBooking_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FieldBooking" ADD CONSTRAINT "FieldBooking_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
