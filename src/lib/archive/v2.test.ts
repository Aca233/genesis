import { describe, expect, it } from "vitest";
import { projectVersionTwoWorld } from "./v2";

describe("version 2 archive projection", () => {
  it("只导出版本字段、保留 mode 且排除运行中操作凭证", () => {
    const projected = projectVersionTwoWorld({
      id: "world-1",
      userId: "local",
      name: "分支世界",
      genesisInput: "创造群星",
      mode: "creator",
      status: "draft",
      lockedPaths: [],
      activeTimelineId: "timeline-1",
      operationKind: "rewrite",
      operationToken: "secret-token",
      operationLeaseExpiresAt: new Date("2026-07-22T00:00:00Z"),
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

    expect(projected).toMatchObject({ mode: "creator", timelines: [{ id: "timeline-1" }] });
    expect(projected).not.toHaveProperty("operationKind");
    expect(projected).not.toHaveProperty("operationToken");
    expect(projected).not.toHaveProperty("operationLeaseExpiresAt");
    expect(projected).not.toHaveProperty("unexpectedWorldField");
    expect(projected.timelines[0]).not.toHaveProperty("branchName");
    expect(projected.timelines[0]).not.toHaveProperty("realityState");
  });
});
