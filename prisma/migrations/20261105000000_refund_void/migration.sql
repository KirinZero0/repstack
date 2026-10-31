-- A refund recorded by mistake is voided, not deleted: it stays on record (who and when) but no longer counts.
ALTER TABLE "Refund" ADD COLUMN "voidedAt" TIMESTAMP(3), ADD COLUMN "voidedById" TEXT;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
