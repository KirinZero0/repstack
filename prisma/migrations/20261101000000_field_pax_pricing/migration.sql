-- CreateEnum
CREATE TYPE "FieldPricing" AS ENUM ('PER_FIELD', 'PER_PAX');
CREATE TYPE "FieldPaymentKind" AS ENUM ('PAYMENT', 'COLLECTION', 'REFUND');

-- AlterTable: fields can charge per person; bookings say how many people and at what rate
ALTER TABLE "Field" ADD COLUMN "pricingType" "FieldPricing" NOT NULL DEFAULT 'PER_FIELD', ADD COLUMN "maxPax" INTEGER;
ALTER TABLE "FieldBooking" ADD COLUMN "pax" INTEGER, ADD COLUMN "rate" DECIMAL(65,30);

-- CreateTable: each movement of money on a booking, with its own date
CREATE TABLE "FieldBookingPayment" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "kind" "FieldPaymentKind" NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldBookingPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FieldBookingPayment_gymId_createdAt_idx" ON "FieldBookingPayment"("gymId", "createdAt");
CREATE INDEX "FieldBookingPayment_bookingId_idx" ON "FieldBookingPayment"("bookingId");

ALTER TABLE "FieldBookingPayment" ADD CONSTRAINT "FieldBookingPayment_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FieldBookingPayment" ADD CONSTRAINT "FieldBookingPayment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "FieldBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FieldBookingPayment" ADD CONSTRAINT "FieldBookingPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bookings that were already approved and priced were paid in full at approval: give each its payment entry, dated then.
INSERT INTO "FieldBookingPayment" ("id", "gymId", "bookingId", "amount", "kind", "recordedById", "createdAt")
SELECT gen_random_uuid()::text, "gymId", "id", "amount", 'PAYMENT', "reviewedById", COALESCE("reviewedAt", "createdAt")
FROM "FieldBooking"
WHERE "status" IN ('APPROVED', 'ATTENDED', 'NO_SHOW') AND "isBlock" = false AND "amount" > 0;
