import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { CreatorWorldDeckSchema, PantheonWorldDeckSchema } from "@/lib/cards/schemas";
import { extractDeckMaterials } from "@/lib/materials/extract-deck";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import type { WorldMode } from "@/lib/world-mode";
import {
  generateGenesisDeck,
  type GenesisGenerationOptions,
  validateGenesisDeck,
} from "./generate";

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

function ipTemporalAnchorCard() {
  return {
    source: {
      basis: "single_ip" as const,
      sourceIps: ["测试原作"],
      continuity: "原著小说线",
      continuitySource: "model_inferred" as const,
      ambiguityNotes: [],
    },
    anchor: {
      anchorType: "main_story_opening" as const,
      currentTimeLabel: "裂光元年冬",
      currentEraLabel: "裂光纪",
      anchorEvent: "主线开幕前夜，晨钟尚未鸣响",
      canonCutoff: "原著第一卷开幕之前",
      selectionSource: "model_inferred" as const,
      confidence: "high" as const,
      assumptions: [],
    },
    anchorOrdinal: 0,
  };
}

describe("generateGenesisDeck", () => {
  it("要求调用方显式冻结生成模式", () => {
    expectTypeOf<GenesisGenerationOptions>().toMatchObjectType<{ mode: WorldMode }>();
  });

  it("导出的 deterministic validator 执行模式与引用校验", () => {
    const deck = completeCreatorDeck();
    expect(validateGenesisDeck(deck, "creator", null)).toEqual(deck);
    expect(() => validateGenesisDeck(deck, "pantheon", null)).toThrow(/模式不匹配/);

    const invalidReferences = completeCreatorDeck();
    invalidReferences.factions[0]!.keyCharacterRefs[0]!.ref = "missing-character";
    expect(() => validateGenesisDeck(invalidReferences, "creator", null)).toThrow();
  });

  it("输出超过字节上限时保留有界前缀并且不进入校验或修补", async () => {
    const repairCompletion = vi.fn();
    const onChunk = vi.fn();
    const onStage = vi.fn();

    await expect(generateGenesisDeck({
      mode: "creator",
      decree: "创造星海",
      maxOutputBytes: 10,
      streamCompletion: async function* () {
        yield "星".repeat(8);
      },
      repairCompletion,
      onChunk,
      onProgress: vi.fn(),
      onStage,
    })).rejects.toMatchObject({
      code: "OUTPUT_LIMIT_EXCEEDED",
      observedBytes: 24,
      limitBytes: 10,
      boundedPrefix: "星星星",
    });

    expect(onChunk).toHaveBeenCalledWith("星星星");
    expect(onStage).not.toHaveBeenCalledWith("validation");
    expect(onStage).not.toHaveBeenCalledWith("repair");
    expect(repairCompletion).not.toHaveBeenCalled();
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

  it("首轮修补调用自身失败时仍使用第二轮修补额度", async () => {
    const deck = completeDeck();
    const repairCompletion = vi.fn()
      .mockRejectedValueOnce(new Error("流式响应为空"))
      .mockResolvedValueOnce(deck);

    await expect(generateGenesisDeck({
      mode: "pantheon",
      decree: "创造测试界",
      streamCompletion: () => chunksOf("{\"mode\":\"pantheon\"}"),
      repairCompletion,
      onProgress: vi.fn(), onChunk: vi.fn(), onStage: vi.fn(),
    })).resolves.toEqual(deck);

    expect(repairCompletion).toHaveBeenCalledTimes(2);
    expect(repairCompletion.mock.calls[1]![0]).toMatchObject({
      invalidOutput: "{\"mode\":\"pantheon\"}",
      validationError: expect.stringContaining("cosmology"),
    });
  });

  it("携带时间锚点的卡组存在时间矛盾时进入定向修补并携带时间码", async () => {
    const anchored = PantheonWorldDeckSchema.parse({
      ...completeDeck(),
      temporalAnchor: ipTemporalAnchorCard(),
    });
    const invalid = structuredClone(anchored);
    // character-2 是 faction-court（active）的关键人物：死人不能当现任领袖（T2）。
    invalid.majorCharacters[1]!.statusAtAnchor = "dead";
    invalid.majorCharacters[1]!.anchorNote = "三年前战死于北境";
    const repairCompletion = vi.fn().mockResolvedValue(anchored);

    await expect(generateGenesisDeck({
      mode: "pantheon",
      decree: "创造测试界",
      streamCompletion: () => chunksOf(JSON.stringify(invalid)),
      repairCompletion,
      onProgress: vi.fn(), onChunk: vi.fn(), onStage: vi.fn(),
    })).resolves.toEqual(anchored);

    expect(repairCompletion).toHaveBeenCalledTimes(1);
    expect(repairCompletion).toHaveBeenCalledWith(expect.objectContaining({
      validationError: expect.stringContaining("T2 DEAD_LEADER"),
    }));
    const validationError = repairCompletion.mock.calls[0]![0].validationError as string;
    expect(validationError).toContain("character-2");
    expect(validationError).toContain("时间一致性校验失败");
  });

  it("无 temporalAnchor 的卡组不受时间验证器影响（迁移守护）", async () => {
    const deck = completeDeck();
    // 即使出现会触发 T2 的锚点状态数据，无锚点卡组也必须原样通过，零修补。
    deck.majorCharacters[1]!.statusAtAnchor = "dead";
    const repairCompletion = vi.fn();

    await expect(generateGenesisDeck({
      mode: "pantheon",
      decree: "创造测试界",
      streamCompletion: () => chunksOf(JSON.stringify(deck)),
      repairCompletion,
      onProgress: vi.fn(), onChunk: vi.fn(), onStage: vi.fn(),
    })).resolves.toEqual(deck);
    expect(repairCompletion).not.toHaveBeenCalled();
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

  it("两轮修补仍违反素材约束时失败且不发起第三轮修补", async () => {
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
    expect(repairCompletion).toHaveBeenCalledTimes(2);
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
