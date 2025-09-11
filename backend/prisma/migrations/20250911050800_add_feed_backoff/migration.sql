-- AlterTable
ALTER TABLE "Feed" ADD COLUMN     "backoffUntil" TIMESTAMP(3),
ADD COLUMN     "errorCount" INTEGER NOT NULL DEFAULT 0;
