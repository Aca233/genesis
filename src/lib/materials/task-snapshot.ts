import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseMaterialVersionContent } from "./schemas";
import { estimateMaterialBudget, summarizeMaterialLocally, validateAbilityOwner, validateSelection } from "./selection";
import { GenesisMaterialSnapshotSchema, MaterialDependencySchema, MaterialSelectionItemSchema, type GenesisMaterialSnapshot, type MaterialSelectionItem } from "./types";

export async function buildGenesisMaterialSnapshot(selections: MaterialSelectionItem[], userId: string): Promise<GenesisMaterialSnapshot | null> {
  if (!selections.length) return null;
  const parsedSelections=selections.map(x=>MaterialSelectionItemSchema.parse(x));
  const versions=await prisma.materialVersion.findMany({where:{id:{in:parsedSelections.map(x=>x.materialVersionId)},card:{userId}},include:{card:true}});
  const byId=new Map(versions.map(v=>[v.id,v]));
  const items=parsedSelections.map(selection=>{
    const version=byId.get(selection.materialVersionId); if(!version||version.cardId!==selection.materialCardId)throw new Error("素材版本不存在或不属于所选卡片");
    let content=parseMaterialVersionContent(version.content); if(selection.compressed)content=summarizeMaterialLocally(content);
    const dependencies=MaterialDependencySchema.array().parse(version.dependencies);
    if(content.kind==="ability"&&selection.abilityOwner?.mode==="selected"){
      const ownerVersion=byId.get(selection.abilityOwner.materialVersionId); if(!ownerVersion)throw new Error("能力拥有者版本未被选择");
      const abilityKind=(content.card as {kind?:string}).kind??""; if(!validateAbilityOwner(abilityKind,ownerVersion.card.kind as never))throw new Error("能力拥有者类型不合法");
    }
    return {selection,card:{id:version.card.id,kind:version.card.kind as never,name:version.card.name,summary:version.card.summary,sourceWorldName:version.card.sourceWorldName,sourceKind:version.card.sourceKind,sourceRef:version.card.sourceRef},version:{id:version.id,version:version.version,name:version.name,content,dependencies,schemaVersion:version.schemaVersion}};
  });
  const chosen=items.map(item=>({id:item.version.id,kind:item.card.kind,mode:item.selection.mode,priority:item.selection.priority,content:item.version.content}));
  const validation=validateSelection(chosen); if(!validation.valid)throw new Error(validation.budget.overLimit?"所选素材超过上下文预算":"完全锁定素材存在不可调和冲突");
  const snapshot=GenesisMaterialSnapshotSchema.parse({schemaVersion:1,items,estimatedChars:estimateMaterialBudget(chosen).estimatedChars});
  await prisma.materialCard.updateMany({where:{id:{in:items.map(x=>x.card.id)},userId},data:{lastUsedAt:new Date()}});
  return snapshot;
}
export function snapshotJson(snapshot:GenesisMaterialSnapshot|null):Prisma.InputJsonValue|undefined{return snapshot as unknown as Prisma.InputJsonValue|undefined}
