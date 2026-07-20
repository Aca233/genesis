-- AlterTable
ALTER TABLE "generation_requests"
ADD COLUMN "error" TEXT,
ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "lease_expires_at" TIMESTAMP(3);
