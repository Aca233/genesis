import { describe, expect, it } from "vitest";
import {
  AbilityKindSchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
  normalizePersistedAbility,
} from "./types";

it("只接受已定义的能力类型、状态和可见性", () => {
  expect(AbilityKindSchema.parse("racial_innate")).toBe("racial_innate");
  expect(AbilityStateSchema.parse("sealed")).toBe("sealed");
  expect(AbilityVisibilitySchema.parse("hidden")).toBe("hidden");
  expect(AbilityKindSchema.safeParse("spell").success).toBe(false);
});


describe("normalizePersistedAbility", () => {
  const persistedAbility = {
    id: "night-sight",
    name: "夜视",
    kind: "racial_innate",
    effect: "在黑暗中辨识轮廓",
    trigger: "进入低光环境",
    cost: "轻微精神负担",
    limitations: "浓雾中效果减弱",
    mastery: "adept",
    state: "impaired",
    visibility: "rumored",
    rumorText: "据说她能看穿永夜。",
    sourceAbilityId: null,
    lockedFields: ["effect"],
    version: 3,
  };

  it("将 Prisma 风格的字符串记录规范化为 AbilityInput", () => {
    expect(normalizePersistedAbility(persistedAbility)).toEqual(persistedAbility);
  });

  it("拒绝非法的持久化枚举值", () => {
    expect(() =>
      normalizePersistedAbility({ ...persistedAbility, kind: "spell" }),
    ).toThrow();
    expect(() =>
      normalizePersistedAbility({ ...persistedAbility, mastery: "legendary" }),
    ).toThrow();
    expect(() =>
      normalizePersistedAbility({ ...persistedAbility, state: "broken" }),
    ).toThrow();
    expect(() =>
      normalizePersistedAbility({ ...persistedAbility, visibility: "public" }),
    ).toThrow();
  });
});
