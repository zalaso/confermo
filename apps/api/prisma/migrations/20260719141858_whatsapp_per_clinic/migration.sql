-- CreateEnum
CREATE TYPE "InboundKind" AS ENUM ('button_confirm', 'button_cancel', 'text', 'opt_out');

-- AlterEnum
ALTER TYPE "ReminderKind" ADD VALUE 'thank_you';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReminderStatus" ADD VALUE 'failed_template';
ALTER TYPE "ReminderStatus" ADD VALUE 'failed_recipient';
ALTER TYPE "ReminderStatus" ADD VALUE 'failed_rate_limit';

-- AlterTable
ALTER TABLE "clinic" ADD COLUMN     "whatsapp_active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp_api_key_enc" TEXT,
ADD COLUMN     "whatsapp_channel_id" TEXT,
ADD COLUMN     "whatsapp_last_test_at" TIMESTAMP(3),
ADD COLUMN     "whatsapp_last_test_error" TEXT,
ADD COLUMN     "whatsapp_last_test_ok" BOOLEAN,
ADD COLUMN     "whatsapp_phone" TEXT,
ADD COLUMN     "whatsapp_webhook_secret" TEXT;

-- AlterTable
ALTER TABLE "patient" ADD COLUMN     "opted_out_at" TIMESTAMP(3),
ADD COLUMN     "wa_window_opened_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "reminder" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "next_retry_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "inbound_message" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID,
    "provider_message_id" TEXT NOT NULL,
    "kind" "InboundKind" NOT NULL,
    "body" TEXT,
    "from_masked" TEXT NOT NULL,
    "needs_attention" BOOLEAN NOT NULL DEFAULT false,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbound_message_clinic_id_needs_attention_idx" ON "inbound_message"("clinic_id", "needs_attention");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_message_clinic_id_provider_message_id_key" ON "inbound_message"("clinic_id", "provider_message_id");

-- AddForeignKey
ALTER TABLE "inbound_message" ADD CONSTRAINT "inbound_message_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_message" ADD CONSTRAINT "inbound_message_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
