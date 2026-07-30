import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { genesisTask: { updateMany: mocks.updateMany } } }));

import { cleanupExpiredGenesisRaw } from "./raw-cleanup";

describe("genesis raw TTL cleanup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears expired raw text without deleting task audit metadata", async () => {
    const now = new Date("2026-07-28T10:00:00.000Z");
    mocks.updateMany.mockResolvedValue({ count: 2 });

    await expect(cleanupExpiredGenesisRaw(now)).resolves.toBe(2);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        rawExpiresAt: { lte: now },
        rawOutput: { not: "" },
        status: { notIn: ["running", "repairing"] },
      },
      data: { rawOutput: "", rawExpiresAt: null },
    });
  });
});
