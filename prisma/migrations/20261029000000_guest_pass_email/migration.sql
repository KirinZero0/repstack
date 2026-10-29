-- AlterTable: guests may leave an email (encrypted) so their ticket can also go by email
ALTER TABLE "GuestPass" ADD COLUMN "email" TEXT;
