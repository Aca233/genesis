import { describe, expect, it } from "vitest";
import {
  beginCodexDetailLoad,
  completeCodexDetailLoad,
  groupAbilityEvents,
  type CodexDetailLoadState,
} from "./codex-detail-state";

type Detail = { id: string };
type Chronicle = { id: string };

const previous: CodexDetailLoadState<Detail, Chronicle> = {
  detail: { id: "old-entity" },
  chronicle: [{ id: "old-chronicle" }],
  abilityHistory: { "old-ability": [{ abilityId: "old-ability", type: "lost" }] },
  error: "旧错误",
  loading: false,
};

describe("Codex detail load state", () => {
  it("实体切换开始请求时同步清空旧详情、编年史、沿革和错误", () => {
    expect(beginCodexDetailLoad(previous)).toEqual({
      detail: null,
      chronicle: [],
      abilityHistory: {},
      error: null,
      loading: true,
    });
  });

  it("成功请求清除旧错误并按 abilityId 分组随详情返回的沿革", () => {
    const next = completeCodexDetailLoad(
      previous,
      { id: "new-entity" },
      [{ id: "new-chronicle" }],
      [
        { id: "event-1", abilityId: "ability-1", type: "learned" },
        { abilityId: "ability-2", revealedAt: "2026-07-20", rumorText: "旧谣" },
        { id: "event-2", abilityId: "ability-1", type: "improved" },
      ],
    );

    expect(next).toEqual({
      detail: { id: "new-entity" },
      chronicle: [{ id: "new-chronicle" }],
      abilityHistory: {
        "ability-1": [
          { id: "event-1", abilityId: "ability-1", type: "learned" },
          { id: "event-2", abilityId: "ability-1", type: "improved" },
        ],
        "ability-2": [
          { abilityId: "ability-2", revealedAt: "2026-07-20", rumorText: "旧谣" },
        ],
      },
      error: null,
      loading: false,
    });
  });
});

describe("groupAbilityEvents", () => {
  it("空沿革保持空映射，兼容旧世界", () => {
    expect(groupAbilityEvents([])).toEqual({});
  });
});
