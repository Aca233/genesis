import { prisma } from "@/lib/db";

/**
 * 规范属主行走 where 构造器(BINDING API)。
 * 关系名已对照 prisma/schema.prisma 验证:Chapter.timeline、Message.chapter、
 * Entity.timeline、Ability.timeline、God.timeline、Timeline.world;
 * World 与 MaterialCard 自带 userId 列。
 *
 * 消费规则(第 4-5 波路由 lane 遵守):
 * - 只需门禁的路由:调 require*(userId, id) 后沿用既有中文 404 分支;
 * - 需要行数据的路由做 MERGE:`findUnique({ where: { id }, ...rest })` →
 *   `findFirst({ where: ownedWhere.<x>(userId, id), ...rest })`
 *   (findUnique 不接受关系过滤);
 * - 路由**永不**手写等价行走。
 */
export const ownedWhere = {
  world: (userId: string, id: string) => ({ id, userId }),
  timeline: (userId: string, id: string) => ({ id, world: { userId } }),
  chapter: (userId: string, id: string) => ({ id, timeline: { world: { userId } } }),
  message: (userId: string, id: string) => ({ id, chapter: { timeline: { world: { userId } } } }),
  entity: (userId: string, id: string) => ({ id, timeline: { world: { userId } } }),
  ability: (userId: string, id: string) => ({ id, timeline: { world: { userId } } }),
  god: (userId: string, id: string) => ({ id, timeline: { world: { userId } } }),
  materialCard: (userId: string, id: string) => ({ id, userId }),
} as const;

/** 门禁返回形状:属主命中返回 { id },否则 null(路由沿用既有中文 404 分支)。 */
type OwnedRow = Promise<{ id: string } | null>;

/** 门禁:世界是否属于该用户。 */
export function requireWorld(userId: string, id: string): OwnedRow {
  return prisma.world.findFirst({ where: ownedWhere.world(userId, id), select: { id: true } });
}

/** 门禁:时间线(经 world.userId 行走)是否属于该用户。 */
export function requireTimeline(userId: string, id: string): OwnedRow {
  return prisma.timeline.findFirst({ where: ownedWhere.timeline(userId, id), select: { id: true } });
}

/** 门禁:章(经 timeline → world 行走)是否属于该用户。 */
export function requireChapter(userId: string, id: string): OwnedRow {
  return prisma.chapter.findFirst({ where: ownedWhere.chapter(userId, id), select: { id: true } });
}

/** 门禁:消息(经 chapter → timeline → world 行走)是否属于该用户。 */
export function requireMessage(userId: string, id: string): OwnedRow {
  return prisma.message.findFirst({ where: ownedWhere.message(userId, id), select: { id: true } });
}

/** 门禁:百科实体(经 timeline → world 行走)是否属于该用户。 */
export function requireEntity(userId: string, id: string): OwnedRow {
  return prisma.entity.findFirst({ where: ownedWhere.entity(userId, id), select: { id: true } });
}

/** 门禁:权能(经 timeline → world 行走)是否属于该用户。 */
export function requireAbility(userId: string, id: string): OwnedRow {
  return prisma.ability.findFirst({ where: ownedWhere.ability(userId, id), select: { id: true } });
}

/** 门禁:神祇(经 timeline → world 行走)是否属于该用户。 */
export function requireGod(userId: string, id: string): OwnedRow {
  return prisma.god.findFirst({ where: ownedWhere.god(userId, id), select: { id: true } });
}

/** 门禁:素材卡是否属于该用户。 */
export function requireMaterialCard(userId: string, id: string): OwnedRow {
  return prisma.materialCard.findFirst({ where: ownedWhere.materialCard(userId, id), select: { id: true } });
}
