-- CreateTable
CREATE TABLE "entity_relations" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "target_entity_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entity_relations_source_entity_id_target_entity_id_key"
    ON "entity_relations"("source_entity_id", "target_entity_id");

-- CreateIndex
CREATE INDEX "entity_relations_timeline_id_idx"
    ON "entity_relations"("timeline_id");

-- CreateIndex
CREATE INDEX "entity_relations_target_entity_id_idx"
    ON "entity_relations"("target_entity_id");

-- AddForeignKey
ALTER TABLE "entity_relations"
    ADD CONSTRAINT "entity_relations_timeline_id_fkey"
    FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relations"
    ADD CONSTRAINT "entity_relations_source_entity_id_fkey"
    FOREIGN KEY ("source_entity_id") REFERENCES "entities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relations"
    ADD CONSTRAINT "entity_relations_target_entity_id_fkey"
    FOREIGN KEY ("target_entity_id") REFERENCES "entities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
