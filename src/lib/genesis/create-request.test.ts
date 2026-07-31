import { describe, expect, it } from "vitest";
import { buildGenesisTaskPayload, createGenesisIdempotencyKey, defaultGenesisMode } from "./create-request";
import { WORLD_MODE_PRESENTATION, worldModeLabel } from "@/lib/world-mode";

describe("genesis creation UI contract", () => {
  it("默认选择创世主并构造 creator 请求", () => {
    expect(defaultGenesisMode).toBe("creator");
    expect(buildGenesisTaskPayload({ decree: "  创造自行运转的星海  " })).toEqual({
      mode: "creator",
      decree: "创造自行运转的星海",
      materialSelections: [],
    });
    expect(WORLD_MODE_PRESENTATION[defaultGenesisMode].subtitle).toContain("自行运转");
  });

  it("切换创世主后请求与世界外文案保持 creator", () => {
    const payload = buildGenesisTaskPayload({
      mode: "creator",
      decree: "  众生在熄灭的群星间自行演化  ",
      lorebook: { name: "星海.json", data: { entries: [] } },
      materialSelections: [{
        materialCardId: "card-1",
        materialVersionId: "version-1",
        mode: "inherit",
        fullLock: false,
        dependencyDecisions: {},
        abilityOwner: null,
        priority: 0,
        compressed: false,
      }],
    });

    expect(payload).toMatchObject({
      mode: "creator",
      decree: "众生在熄灭的群星间自行演化",
      lorebookName: "星海.json",
      lorebook: { entries: [] },
    });
    expect(WORLD_MODE_PRESENTATION.creator.placeholder).not.toMatch(/我是|我是谁/);
    expect(worldModeLabel(payload.mode)).toBe("创世主");
  });

  it("为创建请求生成可复用的 UUID 幂等键", () => {
    expect(createGenesisIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  });
});
