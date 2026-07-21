import { describe, expect, it } from "vitest";
import { inspectPickerSelection, removeSelection, upsertSelection } from "./material-picker-state";
const selection = (id:string,priority:number)=>({materialCardId:id,materialVersionId:`v-${id}`,mode:"remix" as const,fullLock:false,dependencyDecisions:{},abilityOwner:null,priority,compressed:false});
describe("material picker state",()=>{
 it("upserts, orders and compacts selections",()=>{expect(upsertSelection([selection("a",0)],selection("b",1)).map(x=>x.materialCardId)).toEqual(["a","b"]);expect(removeSelection([selection("a",0),selection("b",3)],"a")[0]).toMatchObject({materialCardId:"b",priority:0})});
 it("reports blocking locked conflicts and budget",()=>{const report=inspectPickerSelection([{id:"a",kind:"cosmology",mode:"locked",priority:0,content:{card:{laws:"甲"}}},{id:"b",kind:"cosmology",mode:"locked",priority:1,content:{card:{laws:"乙"}}}] as never);expect(report.blockingMessages).toEqual(expect.arrayContaining([expect.stringContaining("card.laws")]))});
});
