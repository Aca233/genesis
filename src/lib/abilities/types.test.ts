import { expect, it } from "vitest";
import {
  AbilityKindSchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
} from "./types";

it("只接受已定义的能力类型、状态和可见性", () => {
  expect(AbilityKindSchema.parse("racial_innate")).toBe("racial_innate");
  expect(AbilityStateSchema.parse("sealed")).toBe("sealed");
  expect(AbilityVisibilitySchema.parse("hidden")).toBe("hidden");
  expect(AbilityKindSchema.safeParse("spell").success).toBe(false);
});
