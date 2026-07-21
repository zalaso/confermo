-- AlterTable
ALTER TABLE "clinic" ADD COLUMN     "quiet_hours_end" TEXT NOT NULL DEFAULT '08:00',
ADD COLUMN     "quiet_hours_start" TEXT NOT NULL DEFAULT '21:00';
