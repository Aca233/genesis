import { describe, expect, it, vi } from "vitest";
import type { WorldDeck } from "@/lib/cards/schemas";
import {
  completeCreatorDeck,
  completeDeck,
} from "@/lib/abilities/embark.test-fixtures";
import { GENESIS_RAW_MAX_BYTES, utf8Bytes } from "./limits";
import {
  generateLegacyStagedDeck,
  LEGACY_GENESIS_STAGE_IDS,
  legacyGenesisStageSchema,
  type LegacyStageCompletionInput,
  type LegacyGenesisStageId,
} from "./staged-generation";

function splitDeck(deck: WorldDeck): Record<LegacyGenesisStageId, unknown> {
  return {
    laws: {
      mode: deck.mode,
      worldName: deck.worldName,
      temporalAnchor: deck.temporalAnchor,
      cosmology: deck.cosmology,
      fusionAxiom: deck.fusionAxiom,
    },
    gods: deck.mode === "pantheon"
      ? {
        mode: deck.mode,
        playerGod: deck.playerGod,
        majorGods: deck.majorGods,
        minorGods: deck.minorGods,
      }
      : {
        mode: deck.mode,
        majorGods: deck.majorGods,
        minorGods: deck.minorGods,
      },
    peoples: {
      mode: deck.mode,
      races: deck.races,
      factions: deck.factions,
      places: deck.places,
    },
    characters: {
      mode: deck.mode,
      majorCharacters: deck.majorCharacters,
      relationsAtAnchor: deck.relationsAtAnchor,
    },
    conflict: {
      mode: deck.mode,
      epochConflict: deck.epochConflict,
      openingChapterBrief: deck.openingChapterBrief,
      canonEvents: deck.canonEvents,
      style: deck.style,
      theme: deck.theme,
    },
  };
}

describe("legacy staged genesis generation", () => {
  it("按 laws → gods → peoples → characters → conflict 顺序分五次生成", async () => {
    const deck = completeDeck();
    const outputs = splitDeck(deck);
    const calls: Array<{
      stageId: LegacyGenesisStageId;
      acceptedStages: string[];
    }> = [];
    const checkpoints: string[] = [];
    const stages: string[] = [];

    const result = await generateLegacyStagedDeck({
      mode: "pantheon",
      materialSnapshot: null,
      completeStage: vi.fn(async ({ stageId, schema, acceptedOutputs }: LegacyStageCompletionInput) => {
        calls.push({ stageId, acceptedStages: Object.keys(acceptedOutputs) });
        expect(schema.safeParse(outputs[stageId]).success).toBe(true);
        expect(schema.safeParse({
          ...(outputs[stageId] as Record<string, unknown>),
          fieldFromAnotherStage: true,
        }).success).toBe(false);
        return outputs[stageId];
      }),
      onStage: (stage) => {
        stages.push(stage);
      },
      onCheckpointRecovery: () => {},
      onCheckpoint: ({ checkpoint }) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(result).toEqual(deck);
    expect(calls.map(({ stageId }) => stageId)).toEqual(LEGACY_GENESIS_STAGE_IDS);
    expect(calls.map(({ acceptedStages }) => acceptedStages)).toEqual([
      [],
      ["laws"],
      ["laws", "gods"],
      ["laws", "gods", "peoples"],
      ["laws", "gods", "peoples", "characters"],
    ]);
    expect(stages).toEqual([...LEGACY_GENESIS_STAGE_IDS, "validation"]);
    expect(checkpoints).toHaveLength(5);
    expect(utf8Bytes(checkpoints.at(-1)!)).toBeLessThan(GENESIS_RAW_MAX_BYTES);
  });

  it("中断后从 checkpoint 跳过已经完成的段", async () => {
    const deck = completeDeck();
    const outputs = splitDeck(deck);
    const firstCalls: LegacyGenesisStageId[] = [];
    let checkpoint: string | undefined;

    await expect(generateLegacyStagedDeck({
      mode: "pantheon",
      materialSnapshot: null,
      completeStage: async ({ stageId }) => {
        firstCalls.push(stageId);
        return outputs[stageId];
      },
      onStage: () => {},
      onCheckpointRecovery: () => {},
      onCheckpoint: (input) => {
        checkpoint = input.checkpoint;
        if (input.stageId === "gods") throw new Error("模拟连接中断");
      },
    })).rejects.toThrow("模拟连接中断");

    const resumedCalls: LegacyGenesisStageId[] = [];
    const result = await generateLegacyStagedDeck({
      mode: "pantheon",
      materialSnapshot: null,
      checkpoint,
      completeStage: async ({ stageId }) => {
        resumedCalls.push(stageId);
        return outputs[stageId];
      },
      onStage: () => {},
      onCheckpointRecovery: () => {},
      onCheckpoint: () => {},
    });

    expect(firstCalls).toEqual(["laws", "gods"]);
    expect(resumedCalls).toEqual(["peoples", "characters", "conflict"]);
    expect(result).toEqual(deck);
  });

  it("checkpoint 中间段损坏时保留有效前缀并显式同步恢复点", async () => {
    const deck = completeDeck();
    const outputs = splitDeck(deck);
    const calls: LegacyGenesisStageId[] = [];
    const recoveries: Array<{
      nextStage: string;
      completedKeys: string[];
      reason: string;
      checkpoint: string;
    }> = [];
    const damagedCheckpoint = JSON.stringify({
      format: "legacy-staged-v1",
      mode: "pantheon",
      outputs: {
        laws: outputs.laws,
        gods: { mode: "pantheon" },
        peoples: outputs.peoples,
      },
    });

    const result = await generateLegacyStagedDeck({
      mode: "pantheon",
      materialSnapshot: null,
      checkpoint: damagedCheckpoint,
      completeStage: async ({ stageId }) => {
        calls.push(stageId);
        return outputs[stageId];
      },
      onStage: () => {},
      onCheckpointRecovery: (input) => {
        recoveries.push(input);
      },
      onCheckpoint: () => {},
    });

    expect(result).toEqual(deck);
    expect(calls).toEqual(["gods", "peoples", "characters", "conflict"]);
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]).toMatchObject({
      nextStage: "gods",
      reason: "checkpoint 的 gods 段校验失败",
    });
    expect(recoveries[0]!.completedKeys).toEqual([
      "mode",
      "worldName",
      "temporalAnchor",
      "cosmology",
      "fusionAxiom",
    ]);
    expect(JSON.parse(recoveries[0]!.checkpoint)).toMatchObject({
      format: "legacy-staged-v1",
      mode: "pantheon",
      outputs: { laws: expect.any(Object) },
    });
  });

  it("Creator 每段冻结 creator 模式且进度中不出现 playerGod", async () => {
    const deck = completeCreatorDeck();
    const outputs = splitDeck(deck);
    let completedKeys: string[] = [];

    const result = await generateLegacyStagedDeck({
      mode: "creator",
      materialSnapshot: null,
      completeStage: async ({ stageId, schema }) => {
        expect(schema.safeParse({
          ...(outputs[stageId] as Record<string, unknown>),
          mode: "pantheon",
        }).success).toBe(false);
        return outputs[stageId];
      },
      onStage: () => {},
      onCheckpointRecovery: () => {},
      onCheckpoint: (input) => {
        completedKeys = input.completedKeys;
      },
    });

    expect(result).toEqual(deck);
    expect(completedKeys).not.toContain("playerGod");
    expect(completedKeys).toEqual(expect.arrayContaining([
      "majorGods",
      "minorGods",
      "majorCharacters",
      "epochConflict",
      "theme",
    ]));
    expect(legacyGenesisStageSchema("laws", "creator").safeParse({
      ...outputs.laws as Record<string, unknown>,
      mode: "pantheon",
    }).success).toBe(false);
  });

  it("最终引用校验失败时只重做相关人物段，且不把旧坏段标记为不可修改", async () => {
    const deck = completeDeck();
    const outputs = splitDeck(deck);
    const invalidCharacters = structuredClone(outputs.characters as {
      mode: "pantheon";
      majorCharacters: Array<{ raceRef: string }>;
    });
    invalidCharacters.majorCharacters[0]!.raceRef = "race-missing";
    let characterCalls = 0;
    const stages: string[] = [];

    const result = await generateLegacyStagedDeck({
      mode: "pantheon",
      materialSnapshot: null,
      completeStage: async (input) => {
        if (input.stageId !== "characters") return outputs[input.stageId];
        characterCalls += 1;
        if (characterCalls === 1) return invalidCharacters;
        expect(input.previousOutput).toEqual(invalidCharacters);
        expect(input.validationError).toContain("种族引用");
        expect(input.acceptedOutputs).not.toHaveProperty("characters");
        expect(input.acceptedOutputs).toHaveProperty("peoples");
        return outputs.characters;
      },
      onStage: (stage) => {
        stages.push(stage);
      },
      onCheckpointRecovery: () => {},
      onCheckpoint: () => {},
    });

    expect(result).toEqual(deck);
    expect(characterCalls).toBe(2);
    expect(stages).toEqual([
      ...LEGACY_GENESIS_STAGE_IDS,
      "validation",
      "repair",
      "validation",
    ]);
  });

  it("Creator 神间关系悬空时只重做 gods 段", async () => {
    const deck = completeCreatorDeck();
    const outputs = splitDeck(deck);
    const invalidGods = structuredClone(outputs.gods as {
      mode: "creator";
      majorGods: Array<{ relations: Array<{ targetGodRef: string }> }>;
    });
    invalidGods.majorGods[0]!.relations[0]!.targetGodRef = "god-missing";
    let godCalls = 0;

    const result = await generateLegacyStagedDeck({
      mode: "creator",
      materialSnapshot: null,
      completeStage: async (input) => {
        if (input.stageId !== "gods") return outputs[input.stageId];
        godCalls += 1;
        if (godCalls === 1) return invalidGods;
        expect(input.validationError).toContain("主神关系");
        expect(input.acceptedOutputs).not.toHaveProperty("gods");
        expect(input.acceptedOutputs).toHaveProperty("characters");
        return outputs.gods;
      },
      onStage: () => {},
      onCheckpointRecovery: () => {},
      onCheckpoint: () => {},
    });

    expect(result).toEqual(deck);
    expect(godCalls).toBe(2);
  });

  it("多个阶段同时有引用错误时按验证结果依次局部修补", async () => {
    const deck = completeCreatorDeck();
    const outputs = splitDeck(deck);
    const invalidGods = structuredClone(outputs.gods as {
      mode: "creator";
      majorGods: Array<{ relations: Array<{ targetGodRef: string }> }>;
    });
    invalidGods.majorGods[0]!.relations[0]!.targetGodRef = "god-missing";
    const invalidCharacters = structuredClone(outputs.characters as {
      mode: "creator";
      majorCharacters: Array<{ raceRef: string }>;
    });
    invalidCharacters.majorCharacters[0]!.raceRef = "race-missing";
    const calls = new Map<LegacyGenesisStageId, number>();

    const result = await generateLegacyStagedDeck({
      mode: "creator",
      materialSnapshot: null,
      completeStage: async ({ stageId }) => {
        const count = (calls.get(stageId) ?? 0) + 1;
        calls.set(stageId, count);
        if (stageId === "gods" && count === 1) return invalidGods;
        if (stageId === "characters" && count === 1) return invalidCharacters;
        return outputs[stageId];
      },
      onStage: () => {},
      onCheckpointRecovery: () => {},
      onCheckpoint: () => {},
    });

    expect(result).toEqual(deck);
    expect(calls.get("gods")).toBe(2);
    expect(calls.get("characters")).toBe(2);
    expect([...calls.values()].reduce((sum, count) => sum + count, 0)).toBe(7);
  });
});
