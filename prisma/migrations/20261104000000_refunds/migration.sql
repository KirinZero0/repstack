-- Refunds: money a gym gave back, recorded by the owner and subtracted in finance on its own date.
CREATE TYPE "RefundCategory" AS ENUM ('MEMBERSHIP', 'CLASS', 'DAY_PASS', 'FIELD', 'OTHER');
CREATE TYPE "RefundMethod" AS ENUM ('CASH', 'TRANSFER');

CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "recipientName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "category" "RefundCategory" NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Refund_gymId_refundedAt_idx" ON "Refund"("gymId", "refundedAt");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
