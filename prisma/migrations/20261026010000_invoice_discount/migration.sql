-- AlterTable: optional discount on an invoice. "total" stays what is payable.
ALTER TABLE "Invoice"
  ADD COLUMN "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "discountType" TEXT,
  ADD COLUMN "discountValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "discountLabel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Invoices made before discounts had no discount, so their subtotal is their total.
UPDATE "Invoice" SET "subtotal" = "total";
