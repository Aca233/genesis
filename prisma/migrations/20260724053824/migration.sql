-- AlterTable
ALTER TABLE "world_activities" ALTER COLUMN "target_ids" DROP DEFAULT,
ALTER COLUMN "subject_ids" DROP DEFAULT;

-- AlterTable
ALTER TABLE "world_events" ALTER COLUMN "participant_ids" DROP DEFAULT;
