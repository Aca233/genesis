import { describe, expect, it } from "vitest";
import {
  GenesisIntentContractSchema,
  assertGenesisIntentForMode,
  parseGenesisIntent,
} from "./intent";

const crossoverIntent = {
  sourceBasis: "multi_ip",
  sourceIps: ["无职转生", "钢铁侠"],
  explicitPremise: ["鲁迪乌斯由托尼·斯塔克转生"],
  narrativeCenter: {
    identity: "托尼·斯塔克转生后的鲁迪乌斯",
    role: "转生主角",
    startState: "刚出生，仅保留人格、记忆与工程思维",
  },
  playerRole: {
    type: "independent_god",
    narrativeFunction: "limited_intervener",
    mustNotReplaceProtagonist: true,
  },
  forbiddenExpansions: ["独立贾维斯神格", "开局已有钢铁装甲"],
  factsAtAnchor: ["鲁迪乌斯刚出生"],
  futureOnly: ["建立工坊", "验证魔力能否驱动机械"],
  fusionBoundaries: ["工程知识只能提出假设，不能直接改写世界物理规律"],
  uncertaintyPolicy: "omit_or_generalize",
  corePressures: ["婴儿身体限制", "隐瞒成年意识"],
} as const;

describe("GenesisIntentContractSchema", () => {
  it("接受经批准的多 IP 意图契约", () => {
    expect(GenesisIntentContractSchema.parse(crossoverIntent)).toEqual(crossoverIntent);
    expect(parseGenesisIntent(crossoverIntent)).toEqual(crossoverIntent);
    expect(parseGenesisIntent({ ...crossoverIntent, extra: true })).toBeNull();
  });

  it("拒绝把 futureOnly 内容写成锚点事实", () => {
    expect(() => GenesisIntentContractSchema.parse({
      ...crossoverIntent,
      factsAtAnchor: ["建立工坊"],
    })).toThrow(/futureOnly/);
  });
});

describe("assertGenesisIntentForMode", () => {
  it("pantheon 要求不替代主角的 independent_god", () => {
    expect(() => assertGenesisIntentForMode(crossoverIntent, "pantheon")).not.toThrow();
    expect(() => assertGenesisIntentForMode({
      ...crossoverIntent,
      playerRole: {
        ...crossoverIntent.playerRole,
        mustNotReplaceProtagonist: false,
      },
    }, "pantheon")).toThrow(/mustNotReplaceProtagonist/);
  });

  it("creator 要求 external_creator", () => {
    expect(() => assertGenesisIntentForMode(crossoverIntent, "creator")).toThrow(/external_creator/);
    expect(() => assertGenesisIntentForMode({
      ...crossoverIntent,
      playerRole: {
        type: "external_creator",
        narrativeFunction: "external_author",
        mustNotReplaceProtagonist: true,
      },
    }, "creator")).not.toThrow();
  });
});
