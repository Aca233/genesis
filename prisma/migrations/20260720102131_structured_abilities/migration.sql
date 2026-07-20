-- AlterTable
ALTER TABLE "entities" ADD COLUMN     "is_major_character" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "race_id" TEXT;

-- CreateTable
CREATE TABLE "abilities" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "god_id" TEXT,
    "source_ability_id" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "cost" TEXT NOT NULL,
    "limitations" TEXT NOT NULL,
    "mastery" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'normal',
    "visibility" TEXT NOT NULL DEFAULT 'known',
    "rumor_text" TEXT,
    "locked_fields" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "abilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ability_events" (
    "id" TEXT NOT NULL,
    "ability_id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "message_id" TEXT,
    "type" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "evidence" TEXT NOT NULL,
    "scale" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ability_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_memberships" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "faction_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "entity_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "abilities_timeline_id_idx" ON "abilities"("timeline_id");

-- CreateIndex
CREATE INDEX "abilities_entity_id_idx" ON "abilities"("entity_id");

-- CreateIndex
CREATE INDEX "abilities_god_id_idx" ON "abilities"("god_id");

-- CreateIndex
CREATE INDEX "abilities_source_ability_id_idx" ON "abilities"("source_ability_id");

-- CreateIndex
CREATE UNIQUE INDEX "ability_events_dedupe_key_key" ON "ability_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "ability_events_ability_id_created_at_idx" ON "ability_events"("ability_id", "created_at");

-- CreateIndex
CREATE INDEX "ability_events_chapter_id_idx" ON "ability_events"("chapter_id");

-- CreateIndex
CREATE INDEX "ability_events_message_id_idx" ON "ability_events"("message_id");

-- CreateIndex
CREATE INDEX "entity_memberships_faction_id_idx" ON "entity_memberships"("faction_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_memberships_character_id_faction_id_key" ON "entity_memberships"("character_id", "faction_id");

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_race_id_fkey" FOREIGN KEY ("race_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abilities" ADD CONSTRAINT "abilities_timeline_id_fkey" FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abilities" ADD CONSTRAINT "abilities_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abilities" ADD CONSTRAINT "abilities_god_id_fkey" FOREIGN KEY ("god_id") REFERENCES "gods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abilities" ADD CONSTRAINT "abilities_source_ability_id_fkey" FOREIGN KEY ("source_ability_id") REFERENCES "abilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ability_events" ADD CONSTRAINT "ability_events_ability_id_fkey" FOREIGN KEY ("ability_id") REFERENCES "abilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ability_events" ADD CONSTRAINT "ability_events_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ability_events" ADD CONSTRAINT "ability_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_memberships" ADD CONSTRAINT "entity_memberships_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_memberships" ADD CONSTRAINT "entity_memberships_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
