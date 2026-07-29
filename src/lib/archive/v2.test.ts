import { describe, expect, it } from "vitest";
import type { GenesisIntentContract } from "@/lib/genesis/intent";
import { projectVersionTwoWorld } from "./v2";

const crossoverIntent: GenesisIntentContract = {
  sourceBasis: "multi_ip",
  sourceIps: ["无职转生", "钢铁侠"],
  explicitPremise: ["托尼·斯塔克转生为鲁迪乌斯"],
  narrativeCenter: {
    identity: "托尼·斯塔克转生的鲁迪乌斯",
    role: "唯一叙事中心",
    startState: "保留成年意识的新生儿",
  },
  playerRole: {
    type: "independent_god",
    narrativeFunction: "limited_intervener",
    mustNotReplaceProtagonist: true,
  },
  forbiddenExpansions: ["不得把贾维斯设为独立神明"],
  factsAtAnchor: ["托尼保留成年意识"],
  futureOnly: ["魔导铠甲"],
  fusionBoundaries: ["魔法与科技的映射尚未证实"],
  uncertaintyPolicy: "omit_or_generalize",
  corePressures: ["成年意识受婴儿身体限制"],
};

describe("version 2 archive projection", () => {
  it("只导出版本字段、保留 mode 且排除运行中操作凭证", () => {
    const projected = projectVersionTwoWorld({
      id: "world-1",
      userId: "local",
      name: "分支世界",
      genesisInput: "创造群星",
      genesisIntent: crossoverIntent,
      mode: "creator",
      status: "draft",
      lockedPaths: [],
      activeTimelineId: "timeline-1",
      operationKind: "rewrite",
      operationToken: "secret-token",
      operationLeaseExpiresAt: new Date("2026-07-22T00:00:00Z"),
      genesisTasks: [{ intentContract: { runtimeOnly: true }, status: "running" }],
      unexpectedWorldField: "never-export",
      timelines: [{
        id: "timeline-1",
        worldId: "world-1",
        parentId: null,
        forkChapter: null,
        branchName: "内部现实名",
        realityState: { secret: true },
        chapters: [],
        gods: [],
        entities: [],
        abilities: [],
        chronicles: [],
        omens: [],
        createdAt: new Date("2026-07-22T00:00:00Z"),
      }],
      lorebookEntries: [],
      createdAt: new Date("2026-07-22T00:00:00Z"),
      updatedAt: new Date("2026-07-22T00:00:00Z"),
    });

    expect(projected).toMatchObject({
      mode: "creator",
      genesisIntent: crossoverIntent,
      timelines: [{ id: "timeline-1" }],
    });
    expect(projected).not.toHaveProperty("operationKind");
    expect(projected).not.toHaveProperty("operationToken");
    expect(projected).not.toHaveProperty("operationLeaseExpiresAt");
    expect(projected).not.toHaveProperty("genesisTasks");
    expect(projected).not.toHaveProperty("unexpectedWorldField");
    expect(projected.timelines[0]).not.toHaveProperty("branchName");
    expect(projected.timelines[0]).not.toHaveProperty("realityState");
  });
});
