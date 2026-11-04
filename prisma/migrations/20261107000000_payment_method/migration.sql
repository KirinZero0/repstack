-- How money handed to the gym arrived (cash, bank transfer, QRIS), as staff recorded it.
-- Additive only: existing rows keep NULL, which the app shows as "not recorded" (or "Online" for gateway payments).
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'QRIS');

ALTER TABLE "Payment" ADD COLUMN "method" "PaymentMethod";
ALTER TABLE "ClassPayment" ADD COLUMN "method" "PaymentMethod";
ALTER TABLE "GuestPass" ADD COLUMN "method" "PaymentMethod";
ALTER TABLE "FieldBookingPayment" ADD COLUMN "method" "PaymentMethod";
