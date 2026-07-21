-- AlterTable
ALTER TABLE "clinic" ADD COLUMN     "appointment_types" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "demo_mode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "labels" JSONB NOT NULL DEFAULT '{}';
