import type { Scale } from "@/lib/cards/schemas";

export const openingGenerationId = (worldId: string) => `opening:${worldId}`;

export type EmbarkMaterialization = {
  chapterId: string;
  temporal?: { era: string; time: string };
};

export function createEmbarkFlow(dependencies: {
  materialize(): Promise<EmbarkMaterialization>;
  generateOpening(input: {
    chapterId: string;
    scale: Scale;
    mode: "opening";
    generationId: string;
  }): Promise<void>;
  worldId: string;
}) {
  let materialized: EmbarkMaterialization | null = null;

  const generate = async () => {
    if (!materialized) throw new Error("世界尚未物化");
    await dependencies.generateOpening({
      chapterId: materialized.chapterId,
      scale: "scene",
      mode: "opening",
      generationId: openingGenerationId(dependencies.worldId),
    });
    return materialized;
  };

  return {
    async start() {
      materialized ??= await dependencies.materialize();
      return generate();
    },
    async retryOpening() {
      return generate();
    },
    get materialized() {
      return materialized;
    },
  };
}

