-- AlterTable
ALTER TABLE "worlds" ADD COLUMN "icon_theme" JSONB;
ALTER TABLE "worlds" ADD COLUMN "icon_theme_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "worlds" ADD COLUMN "icon_theme_operation_key" TEXT;

-- CreateTable
CREATE TABLE "icon_assignments" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "player_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "icon_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "icon_assignments_timeline_id_subject_type_subject_id_key"
ON "icon_assignments"("timeline_id", "subject_type", "subject_id");

CREATE INDEX "icon_assignments_timeline_id_idx" ON "icon_assignments"("timeline_id");

ALTER TABLE "icon_assignments"
ADD CONSTRAINT "icon_assignments_timeline_id_fkey"
FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
