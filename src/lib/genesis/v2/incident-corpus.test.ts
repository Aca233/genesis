import { describe, expect, it } from "vitest";
import {
  GENESIS_V2_INCIDENT_CATEGORIES,
  GENESIS_V2_INCIDENT_CORPUS,
  type GenesisV2IncidentCategory,
} from "./incident-corpus";

const REQUIRED_CASE_IDS = [
  "genesis-v2.race-abilities.minimum-two",
  "genesis-v2.transport.empty-stream",
  "genesis-v2.transport.socket-terminated",
  "genesis-v2.transport.gateway-504-html",
  "genesis-v2.validation.structured-three-failures",
  "genesis-v2.material.locked-fidelity",
  "genesis-v2.material.inherit-write-protection",
  "genesis-v2.material.full-lock-fidelity",
  "genesis-v2.shadow.forbidden-world-projection",
] as const;

function casesIn(category: GenesisV2IncidentCategory) {
  return GENESIS_V2_INCIDENT_CORPUS.filter((item) => item.category === category);
}

describe("Genesis V2 原事故回归语料", () => {
  it("稳定 case ID 唯一且没有遗漏已知事故", () => {
    const ids = GENESIS_V2_INCIDENT_CORPUS.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([...REQUIRED_CASE_IDS]));
    expect(ids).toHaveLength(REQUIRED_CASE_IDS.length);
  });

  it("每个事故分类均有语料且每条语料至少声明一道硬门", () => {
    for (const category of GENESIS_V2_INCIDENT_CATEGORIES) {
      expect(casesIn(category), `${category} must have a regression case`).not.toHaveLength(0);
    }

    for (const incident of GENESIS_V2_INCIDENT_CORPUS) {
      expect(incident.hardGates, incident.id).not.toHaveLength(0);
    }
  });

  it("结构事故要求固定双能力槽且只能局部修补", () => {
    expect(casesIn("structural_contract")).toMatchObject([
      {
        expectedClassification: "missing_required_slot",
        hardGates: ["reject_unsealed_artifact"],
        expected: {
          requiredSlotIds: ["innate", "tradition"],
          repairScope: "missing_slot_only",
        },
      },
    ]);
  });

  it("传输事故区分空流与未知终局", () => {
    const transportCases = casesIn("transport");
    const emptyStream = transportCases.find(({ id }) => id.endsWith("empty-stream"));
    const terminalUnknown = transportCases.filter(
      ({ expectedClassification }) => expectedClassification === "terminal_unknown",
    );

    expect(emptyStream).toMatchObject({
      expectedClassification: "empty_stream",
      hardGates: ["start_new_physical_attempt"],
    });
    expect(terminalUnknown).toHaveLength(2);
    for (const incident of terminalUnknown) {
      expect(incident.hardGates).toEqual(expect.arrayContaining([
        "hold_permit_until_terminal_evidence",
        "forbid_retry_or_fallback",
      ]));
      expect(incident.expected).toMatchObject({ releasesPermit: false });
    }
  });

  it("三次结构化校验失败后停止且不接受产物", () => {
    expect(casesIn("structured_validation")).toMatchObject([
      {
        expectedClassification: "validation_exhausted",
        hardGates: ["stop_after_validation_budget", "reject_unsealed_artifact"],
        expected: { maximumAttempts: 3, accepted: false },
      },
    ]);
  });

  it("locked、inherit 与 fullLock 各自保留忠实度硬门", () => {
    const fidelityCases = casesIn("source_fidelity");

    expect(fidelityCases.map(({ expectedClassification }) => expectedClassification)).toEqual([
      "locked_source_mismatch",
      "inherit_write_attempt",
      "full_lock_source_mismatch",
    ]);
    expect(fidelityCases.find(({ id }) => id.includes("inherit"))?.hardGates).toContain(
      "exclude_inherited_fields_from_model_writes",
    );
    for (const incident of fidelityCases.filter(({ id }) => !id.includes("inherit"))) {
      expect(incident.hardGates).toContain("preserve_source_fields_exactly");
    }
  });

  it("shadow 模式禁止写入 World 与 draftDeck", () => {
    expect(casesIn("shadow_isolation")).toMatchObject([
      {
        expectedClassification: "forbidden_shadow_write",
        hardGates: ["forbid_world_projection"],
        expected: {
          forbiddenWrites: ["World", "draftDeck"],
          artifactWritesAllowed: true,
        },
      },
    ]);
  });
});
