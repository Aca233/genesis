import { describe, expect, it } from "vitest";
import type { ObserverState } from "./schemas";
import {
  projectChronicleForViewer,
  projectGodAgendaForViewer,
  projectSectionsForViewer,
  realityViewer,
  realityViewerFromPersistence,
} from "./visibility";

const observer = (viewpoint: ObserverState["viewpoint"]): ObserverState => ({
  focusType: "world",
  focusId: null,
  timeLabel: "星海元年",
  viewpoint,
  activeAvatarId: null,
});

describe("reality viewer policy", () => {
  it("creator 的持久化观察视角决定全知或迷雾投影", () => {
    expect(realityViewer("creator", observer("omniscient"))).toBe("creator_omniscient");
    expect(realityViewer("creator", observer("limited"))).toBe("creator_limited");
  });

  it("pantheon 永远使用玩家投影，不能借 omniscient 观察状态升级", () => {
    expect(realityViewer("pantheon", observer("omniscient"))).toBe("pantheon_player");
  });

  it("creator 缺失或损坏的观察状态按迷雾处理而非意外泄密", () => {
    expect(realityViewerFromPersistence("creator", null)).toBe("creator_limited");
    expect(realityViewerFromPersistence("creator", { viewpoint: "omniscient" })).toBe("creator_limited");
  });
});

describe("reality projections", () => {
  const hiddenSection = {
    id: "section-secret",
    key: "secret",
    content: { text: "王冠内封印着旧神。" },
    revealed: false,
    rumorText: "王冠会在午夜低语。",
  };
  const hiddenChronicle = {
    id: "chronicle-secret",
    text: "月神暗中熄灭了北方灯塔。",
    revealed: false,
  };

  it("全知 creator 获得未揭示栏目、议程与幕后编年史，同时保留世界内可见标记", () => {
    expect(projectSectionsForViewer([hiddenSection], "creator_omniscient")).toEqual([hiddenSection]);
    expect(projectGodAgendaForViewer({ schemes: ["遮蔽星门"] }, false, "creator_omniscient"))
      .toEqual({ schemes: ["遮蔽星门"] });
    expect(projectChronicleForViewer(hiddenChronicle, "creator_omniscient")).toEqual({
      ...hiddenChronicle,
      worldVisible: false,
    });
  });

  it("迷雾 creator 与 pantheon 都隐藏未公开真相", () => {
    for (const viewer of ["creator_limited", "pantheon_player"] as const) {
      expect(projectSectionsForViewer([hiddenSection], viewer)).toEqual([{
        ...hiddenSection,
        content: null,
      }]);
      expect(projectGodAgendaForViewer({ schemes: ["遮蔽星门"] }, false, viewer)).toBeNull();
      expect(projectChronicleForViewer(hiddenChronicle, viewer)).toBeNull();
    }
  });
});
