import { describe, expect, it } from "vitest";
import {
  assertSingleAcceptedArtifact,
  buildGenesisV2ReuseKey,
  canTransitionArtifact,
  hashGenesisV2ArtifactContent,
} from "./artifacts";

describe("Genesis V2 artifact lifecycle", () => {
  it("只允许单调生命周期转换", () => {
    expect(canTransitionArtifact("candidate", "accepted")).toBe(true);
    expect(canTransitionArtifact("accepted", "sealed")).toBe(true);
    expect(canTransitionArtifact("sealed", "candidate")).toBe(false);
    expect(canTransitionArtifact("rejected", "accepted")).toBe(false);
  });

  it("内容和复用键使用稳定哈希", () => {
    expect(hashGenesisV2ArtifactContent({ b: 2, a: 1 }))
      .toBe(hashGenesisV2ArtifactContent({ a: 1, b: 2 }));
    expect(buildGenesisV2ReuseKey({
      stageId: "characters",
      contractVersion: "v1",
      inputHash: "input",
      dependencyHashes: ["b", "a"],
    })).toBe(buildGenesisV2ReuseKey({
      stageId: "characters",
      contractVersion: "v1",
      inputHash: "input",
      dependencyHashes: ["a", "b"],
    }));
  });

  it("拒绝同阶段存在两个 accepted 权威", () => {
    expect(() => assertSingleAcceptedArtifact([
      { stageId: "blueprint", status: "accepted" },
      { stageId: "blueprint", status: "sealed" },
    ])).toThrow("multiple accepted");
  });
});
