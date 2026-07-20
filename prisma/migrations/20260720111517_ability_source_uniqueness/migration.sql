/*
  Warnings:

  - A unique constraint covering the columns `[entity_id,source_ability_id]` on the table `abilities` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "abilities_entity_id_source_ability_id_key" ON "abilities"("entity_id", "source_ability_id");
