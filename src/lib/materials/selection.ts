import type { MaterialKind, ReuseMode } from "./types";
import type { MaterialVersionContent } from "./schemas";

export const MATERIAL_INPUT_LIMIT = 120_000;
export type SelectedMaterial = { id: string; kind: MaterialKind; mode: ReuseMode; priority: number; content: MaterialVersionContent | Record<string, unknown> };
export type MaterialConflict = { leftId: string; rightId: string; path: string; severity: "blocking"|"priority"|"model"; message: string };

export function validateAbilityOwner(abilityKind: string, ownerKind: MaterialKind) {
  if (abilityKind === "divine") return ownerKind === "player_god" || ownerKind === "major_god";
  if (abilityKind === "personal") return ownerKind === "character";
  if (abilityKind === "racial_innate" || abilityKind === "racial_tradition") return ownerKind === "race";
  return false;
}
function scalars(value: unknown, prefix="", out=new Map<string,unknown>()) {
  if (value === null || ["string","number","boolean"].includes(typeof value)) { out.set(prefix,value); return out; }
  if (Array.isArray(value)) return out;
  if (value && typeof value === "object") for (const [key,child] of Object.entries(value)) scalars(child,prefix?`${prefix}.${key}`:key,out);
  return out;
}
export function detectMaterialConflicts(items: SelectedMaterial[]): MaterialConflict[] {
 const result:MaterialConflict[]=[];
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
  const a=items[i]!,b=items[j]!; if(a.kind!==b.kind)continue;
  const right=scalars(b.content);
  for(const [path,left] of scalars(a.content)) if(right.has(path)&&JSON.stringify(left)!==JSON.stringify(right.get(path))){
   const severity=a.mode==="locked"&&b.mode==="locked"?"blocking":a.mode==="remix"&&b.mode==="remix"?"model":"priority";
   result.push({leftId:a.id,rightId:b.id,path,severity,message:`${path} 存在冲突`});
  }
 }
 return result;
}
export function estimateMaterialBudget(items:Array<{id:string;content:unknown}>) {
 const sizes=items.map(item=>({id:item.id,chars:JSON.stringify(item.content).length})).sort((a,b)=>b.chars-a.chars);
 const estimatedChars=sizes.reduce((sum,x)=>sum+x.chars,0);
 return {estimatedChars,overLimit:estimatedChars>MATERIAL_INPUT_LIMIT,largest:sizes.slice(0,5)};
}
export function summarizeMaterialLocally(content: MaterialVersionContent): MaterialVersionContent {
 const clone=structuredClone(content) as MaterialVersionContent;
 const card=(clone as {card?:Record<string,unknown>}).card;
 if(card){for(const key of Object.keys(card)){if(typeof card[key]==="string"&&(card[key] as string).length>500)card[key]=(card[key] as string).slice(0,500)}}
 return clone;
}
export function validateSelection(items: SelectedMaterial[]) {
 const conflicts=detectMaterialConflicts(items); const budget=estimateMaterialBudget(items);
 return {conflicts,budget,valid:!budget.overLimit&&!conflicts.some(x=>x.severity==="blocking"),fusionAxiomRequired:conflicts.some(x=>x.severity==="model")};
}
