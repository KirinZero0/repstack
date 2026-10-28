-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('default', 'member_activation', 'member_welcome', 'renewal_confirmed', 'payment_receipt', 'expiry_reminder', 'expired_notice', 'manual_reminder', 'password_reset', 'qr_fallback', 'class_confirmation', 'class_reminder', 'class_cancelled', 'guest_ticket', 'guest_rejected');

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "gymId" TEXT,
    "type" "MessageType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailTemplate_type_idx" ON "EmailTemplate"("type");
CREATE UNIQUE INDEX "EmailTemplate_gymId_type_key" ON "EmailTemplate"("gymId", "type");
-- A plain unique index treats NULLs as distinct, so also allow only one platform default per type.
CREATE UNIQUE INDEX "EmailTemplate_platform_type_key" ON "EmailTemplate"("type") WHERE "gymId" IS NULL;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;
