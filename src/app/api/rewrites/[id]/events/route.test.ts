import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  findFirst: vi.fn(),
  dto: vi.fn((task: Record<string, unknown>) => task),
  stages: vi.fn(() => ["planning", "branching", "applying", "narrating", "completed"]),
}));

vi.mock("@/lib/db", () => ({
  prisma: { realityRewrite: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/reality/task-runner", () => ({
  ensureRealityRewriteRunning: mocks.ensure,
  rewriteStages: mocks.stages,
  toRealityRewriteDto: mocks.dto,
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "rewrite-1" }) };

describe("rewrite SSE events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({
      id: "rewrite-1",
      status: "completed",
      resultTimelineId: "timeline-2",
      updatedAt: "2026-07-22T00:00:00.000Z",
    });
  });

  it("streams sanitized progress stages and closes on completion", async () => {
    const response = await GET(new Request("http://localhost/api/rewrites/rewrite-1/events"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await response.text();
    for (const stage of ["planning", "branching", "applying", "narrating", "completed"]) {
      expect(body).toContain(`event: ${stage}`);
    }
    expect(body).not.toContain("leaseToken");
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("returns 404 before opening a stream for another user's or missing task", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/rewrites/missing/events"), context);
    expect(response.status).toBe(404);
  });
});
