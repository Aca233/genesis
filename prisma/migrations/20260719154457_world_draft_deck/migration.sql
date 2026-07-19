-- AlterTable
ALTER TABLE "worlds" ADD COLUMN     "draft_deck" JSONB,
ADD COLUMN     "locked_paths" TEXT[];
