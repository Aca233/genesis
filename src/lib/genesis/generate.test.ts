import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { CreatorWorldDeckSchema, PantheonWorldDeckSchema } from "@/lib/cards/schemas";
import { extractDeckMaterials } from "@/lib/materials/extract-deck";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import type { WorldMode } from "@/lib/world-mode";
import { generateGenesisDeck, type GenesisGenerationOptions } from "./generate";

async function* chunksOf(text: string, size = 17) {
  for (let index = 0; index < text.length; index += size) {
    yield text.slice(index, index + size);
  }
}

function completeCreatorDeck() {
  const pantheon = completeDeck();
  const { playerGod: _playerGod, ...shared } = pantheon;
  void _playerGod;
  return CreatorWorldDeckSchema.parse({
    ...shared,
    mode: "creator",
    majorGods: shared.majorGods.map(({ agenda, initialRelationToPlayer: _relation, ...god }, index, gods) => {
      void _relation;
      return {
        ...god,
        agenda: {
          longTermGoal: agenda.longTermGoal,
          shortTermGoals: agenda.shortTermGoals,
          methods: agenda.methods,
          schemes: agenda.schemes,
        },
        relations: [{
          targetGodRef: gods[(index + 1) % gods.length]!.ref,
          label: "rival",
          note: "世界内神明之间的竞争",
        }],
      };
    }),
  });
}

describe("generateGenesisDeck", () => {
  it("要求调用方显式冻结生成模式", () => {
    expectTypeOf<GenesisGenerationOptions>().toMatchObjectType<{ mode: WorldMode }>();
  });

  it("合法 creator 首轮输出无需修补即可成功", async () => {
    const creator = completeCreatorDeck();
    const repairCompletion = vi.fn();

    await expect(generateGenesisDeck({
      mode: "creator",
      decree: "创造测试界",
      streamCompletion: () => chunksOf(JSON.stringify(creator)),
      repairCompletion,
      onProgress: vi.fn(), onChunk: vi.fn(), onStage: vi.fn(),
    })).resolves.toEqual(creator);
    expect(repairCompletion).not.toHaveBeenCalled();
  });

  it("合法 creator 修补使用 Creator schema 并成功返回", async () => {
    const creator = completeCreatorDeck();
    const repairCompletion = vi.fn(async (input) => {
      expect(input.mode).toBe("creator");
      expect(input.schema).toBe(CreatorWorldDeckSchema);
      return input.schema.parse(creator);
    });

    await expect(generateGenesisDeck({
      mode: "creator",
      decree: "创造测试界",
      streamCompletion: () => chunksOf('{"mode":"creator"}'),
      repairCompletion,
      onProgress: vi.fn(), onChunk: vi.fn(), onStage: vi.fn(),
    })).resolves.toEqual(creator);
    expect(repairCompletion).toHaveBeenCalledTimes(1);
  });

  it("流式读取卡组并在顶层值闭合时报告真实进度", async () => {
    const deck = completeDeck();
    const progress: Array<{ keys: string[]; raw: string }> = [];

    const result = await generateGenesisDeck({
      mode: "pantheon",
      decree: "创造测试界",
      streamCompletion: () => chunksOf(JSON.stringify(deck), 11),
      repairCompletion: vi.fn(),
      onProgress: async (keys, raw) => { progress.push({ keys: [...keys], raw }); },
      onChunk: vi.fn(),
      onStage: vi.fn(),
    });

    expect(result).toEqual(deck);
    expect(progress.at(-1)?.keys).toEqual([
      "mode", "worldName", "cosmology", "fusionAxiom", "playerGod", "majorGods", "minorGods",
      "factions", "races", "places", "majorCharacters", "epochConflict", "style", "theme",
    ]);
    expect(progress.some(({ keys }) => keys.includes("worldName") && !keys.includes("theme"))).toBe(true);
    expect(progress.at(-1)?.raw).toBe(JSON.stringify(deck));
    // Heartbeats can be persisted even while a large top-level value is still open.
    expect(result).toEqual(deck);
  });

  it("每个模型文本块都可触发心跳检查点", async () => {
    const deck = completeDeck();
    const onChunk = vi.fn();

    await generateGenesisDeck({
      mode: "pantheon",
      decree: "创造测试界",
      streamCompletion: () => chunksOf(JSON.stringify(deck), 100),
      repairCompletion: vi.fn(),
      onProgress: vi.fn(),
      onChunk,
      onStage: vi.fn(),
    });

    expect(onChunk.mock.calls.length).toBeGreaterThan(2);
    expect(onChunk.mock.calls.at(-1)?.[0]).toBe(JSON.stringify(deck));
  });

  it("流式结果结构错误时进入修补阶段并以修补结果为准", async () => {
    const deck = completeDeck();
    const repairCompletion = vi.fn().mockResolvedValue(deck);
    const onStage = vi.fn();

    const result = await generateGenesisDeck({
      mode: "pantheon",
      decree: "创造测试界",
      streamCompletion: () => chunksOf('{"mode":"pantheon","worldName":"破碎界"}'),
      repairCompletion,
      onProgress: vi.fn(),
      onChunk: vi.fn(),
      onStage,
    });

    expect(result).toEqual(deck);
    expect(onStage).toHaveBeenCalledWith("validation");
    expect(onStage).toHaveBeenCalledWith("repair");
    expect(repairCompletion).toHaveBeenCalledWith(expect.objectContaining({
      schema: PantheonWorldDeckSchema,
      invalidOutput: '{"mode":"pantheon","worldName":"破碎界"}',
      validationError: expect.stringContaining("cosmology"),
    }));
  });

  it("引用无效时也进入定向修补", async () => {
    const deck = completeDeck();
    const invalid = structuredClone(deck);
    invalid.majorCharacters[0]!.raceRef = "missing-race";
    const repairCompletion = vi.fn().mockResolvedValue(deck);

    await generateGenesisDeck({
      mode: "pantheon",
      decree: "创造测试界",
      streamCompletion: () => chunksOf(JSON.stringify(invalid)),
      repairCompletion,
      onProgress: vi.fn(),
      onChunk: vi.fn(),
      onStage: vi.fn(),
    });

    expect(repairCompletion).toHaveBeenCalledWith(expect.objectContaining({
      validationError: expect.stringContaining("种族引用"),
    }));
  });

  it("素材继承约束失败时复用现有唯一修补并再次验证", async () => {
    const deck = completeDeck();
    const material = extractDeckMaterials(deck).find((item) => item.kind === "major_god")!;
    const snapshot: GenesisMaterialSnapshot = {
      schemaVersion: 1,
      estimatedChars: 1,
      items: [{
        selection: {
          materialCardId: "card-god", materialVersionId: "version-god", mode: "locked",
          fullLock: true, dependencyDecisions: {}, abilityOwner: null, priority: 0, compressed: false,
        },
        card: {
          id: "card-god", kind: material.kind, name: material.name, summary: material.summary,
          sourceWorldName: "旧世界", sourceKind: material.sourceKind, sourceRef: material.sourceRef,
        },
        version: {
          id: "version-god", version: 1, name: "初始版", content: material.content,
          dependencies: material.dependencies, schemaVersion: 1,
        },
      }],
    };
    const invalid = structuredClone(deck);
    invalid.majorGods[0]!.persona += "改动";
    const repairCompletion = vi.fn().mockResolvedValue(deck);

    await generateGenesisDeck({
      mode: "pantheon",
      decree: "创造测试界",
      materialSnapshot: snapshot,
      streamCompletion: () => chunksOf(JSON.stringify(invalid)),
      repairCompletion,
      onProgress: vi.fn(), onChunk: vi.fn(), onStage: vi.fn(),
    });

    expect(repairCompletion).toHaveBeenCalledTimes(1);
    expect(repairCompletion).toHaveBeenCalledWith(expect.objectContaining({
      validationError: expect.stringContaining("locked_mismatch"),
    }));
  });

  it("修补输出仍违反素材约束时直接失败且不发起第三次调用", async () => {
    const deck = completeDeck();
    const material = extractDeckMaterials(deck).find((item) => item.kind === "major_god")!;
    const snapshot = {
      schemaVersion: 1 as const, estimatedChars: 1,
      items: [{
        selection: { materialCardId: "c", materialVersionId: "v", mode: "locked" as const, fullLock: true, dependencyDecisions: {}, abilityOwner: null, priority: 0, compressed: false },
        card: { id: "c", kind: material.kind, name: material.name, summary: material.summary, sourceWorldName: "旧", sourceKind: material.sourceKind, sourceRef: material.sourceRef },
        version: { id: "v", version: 1, name: "v1", content: material.content, dependencies: material.dependencies, schemaVersion: 1 },
      }],
    };
    const invalid = structuredClone(deck);
    invalid.majorGods[0]!.persona += "改动";
    const repairCompletion = vi.fn().mockResolvedValue(invalid);
    await expect(generateGenesisDeck({
      mode: "pantheon", decree: "创造测试界", materialSnapshot: snapshot,
      streamCompletion: () => chunksOf(JSON.stringify(invalid)), repairCompletion,
      onProgress: vi.fn(), onChunk: vi.fn(), onStage: vi.fn(),
    })).rejects.toThrow("素材继承约束验证失败");
    expect(repairCompletion).toHaveBeenCalledTimes(1);
  });


  it("拒绝流式卡组模式与冻结生成模式不一致并传入准确修补模式", async () => {
    const pantheon = completeDeck();
    const { playerGod: _playerGod, ...shared } = pantheon;
    void _playerGod;
    const creator = {
      ...shared,
      mode: "creator" as const,
      majorGods: shared.majorGods.map(({ agenda, initialRelationToPlayer: _relation, ...god }) => {
        void _relation;
        return {
          ...god,
          agenda: {
            longTermGoal: agenda.longTermGoal,
            shortTermGoals: agenda.shortTermGoals,
            methods: agenda.methods,
            schemes: agenda.schemes,
          },
          relations: [],
        };
      }),
    };
    const repairCompletion = vi.fn().mockResolvedValue(pantheon);

    await generateGenesisDeck({
      mode: "pantheon",
      decree: "创造测试界",
      streamCompletion: () => chunksOf(JSON.stringify(creator)),
      repairCompletion,
      onProgress: vi.fn(), onChunk: vi.fn(), onStage: vi.fn(),
    });

    expect(repairCompletion).toHaveBeenCalledWith(expect.objectContaining({
      mode: "pantheon",
      validationError: expect.stringContaining("模式"),
    }));
  });

  it("creator 修补结果即使伪装为 creator 也不能重新引入 playerGod", async () => {
    const pantheon = completeDeck();
    const creator = {
      ...pantheon,
      mode: "creator" as const,
      majorGods: pantheon.majorGods.map(({ agenda, initialRelationToPlayer: _relation, ...god }) => {
        void _relation;
        return {
          ...god,
          agenda: {
            longTermGoal: agenda.longTermGoal,
            shortTermGoals: agenda.shortTermGoals,
            methods: agenda.methods,
            schemes: agenda.schemes,
          },
          relations: [],
        };
      }),
    };
    delete (creator as Record<string, unknown>).playerGod;

    await expect(generateGenesisDeck({
      mode: "creator",
      decree: "创造测试界",
      streamCompletion: () => chunksOf('{"mode":"creator"}'),
      repairCompletion: vi.fn().mockResolvedValue({ ...creator, playerGod: pantheon.playerGod }),
      onProgress: vi.fn(), onChunk: vi.fn(), onStage: vi.fn(),
    })).rejects.toThrow();
  });

});
