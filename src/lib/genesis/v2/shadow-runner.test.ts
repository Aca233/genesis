import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  candidate: vi.fn(),
  acceptedCount: vi.fn(),
  jobUpdateMany: vi.fn(),
  claimedJob: vi.fn(),
  dependencyFindMany: vi.fn(),
  artifactFindFirst: vi.fn(),
  ownedJob: vi.fn(),
  artifactUpdateMany: vi.fn(),
  artifactCreate: vi.fn(),
  jobUpdate: vi.fn(),
  taskUpdate: vi.fn(),
  taskUpdateMany: vi.fn(),
}));

const tx = {
  genesisJob: {
    findUnique: mocks.candidate,
    findUniqueOrThrow: mocks.claimedJob,
    findFirst: mocks.ownedJob,
    updateMany: mocks.jobUpdateMany,
    update: mocks.jobUpdate,
  },
  genesisArtifact: {
    count: mocks.acceptedCount,
    updateMany: mocks.artifactUpdateMany,
    create: mocks.artifactCreate,
  },
  genesisTask: { update: mocks.taskUpdate },
};

vi.mock("@/lib/db", () => ({ prisma: {
  $transaction: vi.fn((callback) => callback(tx)),
  genesisArtifact: {
    findMany: mocks.dependencyFindMany,
    findFirst: mocks.artifactFindFirst,
  },
  genesisJob: { updateMany: mocks.jobUpdateMany },
  genesisTask: { updateMany: mocks.taskUpdateMany },
} }));
vi.mock("@/lib/llm/structured", () => ({ completeStructured: mocks.complete }));

import { runGenesisShadowJob } from "./shadow-runner";

const preflight = {
  preflightHash: "preflight-hash",
  structuralManifest: { manifestHash: "manifest-hash", slots: [] },
  sourceObligationManifest: { obligations: [] },
  budgetPlan: {
    stages: [{ stage: "blueprint", maxOutputTokens: 4000 }],
  },
};

describe("Genesis V2 shadow runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.candidate.mockResolvedValue({
      id: "job-blueprint",
      genesisTaskId: "task-1",
      nodeKey: "shadow:blueprint",
      task: {
        status: "completed",
        shadowEnabled: true,
      },
    });
    mocks.acceptedCount.mockResolvedValue(0);
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.claimedJob.mockResolvedValue({
      id: "job-blueprint",
      genesisTaskId: "task-1",
      nodeKey: "shadow:blueprint",
      leaseToken: "lease-1",
      leaseEpoch: 2,
      leaseExpiresAt: new Date("2026-07-28T12:01:00.000Z"),
      attempt: 1,
      inputHash: "preflight-hash",
      task: {
        userId: "user-1",
        mode: "pantheon",
        decree: "创造潮汐星海",
        shadowPreflight: preflight,
        shadowPreflightHash: "preflight-hash",
      },
    });
    mocks.dependencyFindMany.mockResolvedValue([]);
    mocks.artifactFindFirst.mockResolvedValue(null);
    mocks.ownedJob.mockResolvedValue({ id: "job-blueprint" });
    mocks.complete.mockResolvedValue({ canonBrief: "潮汐统治星辰", slotBriefs: {} });
    mocks.artifactUpdateMany.mockResolvedValue({ count: 0 });
    mocks.artifactCreate.mockResolvedValue({});
    mocks.jobUpdate.mockResolvedValue({});
    mocks.taskUpdate.mockResolvedValue({});
  });

  it("只写 shadow Artifact，并以独立预算和最低优先级调用模型", async () => {
    await runGenesisShadowJob("job-blueprint");

    expect(mocks.complete).toHaveBeenCalledWith("backstage", expect.objectContaining({
      task: "world-director-probe",
      maxAttempts: 1,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
      owner: expect.objectContaining({
        genesisTaskId: "task-1",
        genesisJobId: "job-blueprint",
        budgetScope: "shadow",
      }),
    }));
    expect(mocks.artifactCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      stageKey: "blueprint",
      status: "accepted",
      visibility: "shadow",
    }) });
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed" }),
    }));
    expect("world" in tx).toBe(false);
  });

  it("legacy 尚未完成时不领取也不调用模型", async () => {
    mocks.candidate.mockResolvedValue({
      id: "job-blueprint",
      genesisTaskId: "task-1",
      nodeKey: "shadow:blueprint",
      task: { status: "running", shadowEnabled: true },
    });

    await runGenesisShadowJob("job-blueprint");

    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.artifactCreate).not.toHaveBeenCalled();
  });
});
