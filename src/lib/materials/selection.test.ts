import { describe, expect, it } from "vitest";
import { validateAbilityOwner, detectMaterialConflicts, estimateMaterialBudget } from "./selection";

describe("material selection",()=>{
 it("enforces owner kinds and classifies hard lock conflicts",()=>{
  expect(validateAbilityOwner("divine","character")).toBe(false);
  expect(validateAbilityOwner("divine","major_god")).toBe(true);
  const conflicts=detectMaterialConflicts([
   {id:"a",kind:"cosmology",mode:"locked",priority:0,content:{card:{laws:"唯有血脉"}}},
   {id:"b",kind:"cosmology",mode:"locked",priority:1,content:{card:{laws:"唯有机械"}}},
  ] as never);
  expect(conflicts[0]).toMatchObject({severity:"blocking",path:"card.laws"});
 });
 it("reports estimated chars and largest cards",()=>{const budget=estimateMaterialBudget([{id:"a",content:{x:"a".repeat(20)}}] as never);expect(budget.estimatedChars).toBeGreaterThanOrEqual(20);expect(budget.largest[0]?.id).toBe("a")});
});
