import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '@/db/client'
import {
  taskClasses, taskEdgeTags, vehicleClasses, vehicleEdgeTags,
  userFollowedVehicleClasses,
} from '@/db/schema/taxonomy'

export async function listVehicleClasses(db: Db) {
  return db.select().from(vehicleClasses).orderBy(vehicleClasses.level, vehicleClasses.name)
}

export async function createVehicleClass(db: Db, input: { name: string; level: 1 | 2; parentId?: string; description?: string }) {
  const [row] = await db.insert(vehicleClasses).values({
    name: input.name,
    level: input.level,
    parentId: input.parentId ?? null,
    description: input.description ?? null,
  }).returning()
  return row!
}

export async function listTaskClasses(db: Db) {
  return db.select().from(taskClasses).orderBy(taskClasses.level, taskClasses.name)
}

export async function createTaskClass(db: Db, input: { name: string; level: 1 | 2; parentId?: string; description?: string }) {
  const [row] = await db.insert(taskClasses).values({
    name: input.name,
    level: input.level,
    parentId: input.parentId ?? null,
    description: input.description ?? null,
  }).returning()
  return row!
}

export async function attachVehicleEdgeTag(db: Db, vehicleClassId: string, tag: string, createdBy?: string) {
  const [row] = await db.insert(vehicleEdgeTags).values({
    vehicleClassId, tag, createdBy: createdBy ?? null,
  }).returning()
  return row!
}

export async function attachTaskEdgeTag(db: Db, taskClassId: string, tag: string, createdBy?: string) {
  const [row] = await db.insert(taskEdgeTags).values({
    taskClassId, tag, createdBy: createdBy ?? null,
  }).returning()
  return row!
}

// ── Plan-PP: vehicle class CRUD (ADMIN) ───────────────────────────────────
export async function updateVehicleClass(db: Db, id: string, input: { name?: string; description?: string | null }) {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.description !== undefined) patch.description = input.description
  if (Object.keys(patch).length === 0) {
    const [r] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.id, id))
    return r ?? null
  }
  const [row] = await db.update(vehicleClasses).set(patch).where(eq(vehicleClasses.id, id)).returning()
  return row ?? null
}

export async function deleteVehicleClass(db: Db, id: string): Promise<{ deleted: boolean; reason?: string }> {
  // Children check
  const kids = await db.select({ id: vehicleClasses.id }).from(vehicleClasses)
    .where(eq(vehicleClasses.parentId, id)).limit(1)
  if (kids.length > 0) return { deleted: false, reason: 'has-children' }
  // Followed-by check 不阻塞删除 — cascade 自动清 ufvc
  const r = await db.delete(vehicleClasses).where(eq(vehicleClasses.id, id)).returning({ id: vehicleClasses.id })
  return { deleted: r.length > 0 }
}

// ── Plan-PP: user-followed vehicle classes ────────────────────────────────
export async function listFollowedVehicleClasses(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ id: userFollowedVehicleClasses.vehicleClassId })
    .from(userFollowedVehicleClasses)
    .where(eq(userFollowedVehicleClasses.userId, userId))
  return rows.map((r) => r.id)
}

export async function followVehicleClass(db: Db, userId: string, vehicleClassId: string): Promise<void> {
  await db.insert(userFollowedVehicleClasses)
    .values({ userId, vehicleClassId })
    .onConflictDoNothing()
}

export async function unfollowVehicleClass(db: Db, userId: string, vehicleClassId: string): Promise<void> {
  await db.delete(userFollowedVehicleClasses).where(and(
    eq(userFollowedVehicleClasses.userId, userId),
    eq(userFollowedVehicleClasses.vehicleClassId, vehicleClassId),
  ))
}

/**
 * 计算用户「有效关注」的 level-2 集合 — 关注 level-1 父节点时,自动展开为其所有
 * level-2 子节点(Q3=B 行为)。返回 (level-2 ids) — extract LLM 用此集合作 V 选项。
 */
export async function resolveEffectiveFollowedLevel2(db: Db, userId: string): Promise<string[]> {
  const followedIds = await listFollowedVehicleClasses(db, userId)
  if (followedIds.length === 0) return []
  // 拿 followed 的全部行,分级处理
  const followed = await db.select().from(vehicleClasses).where(inArray(vehicleClasses.id, followedIds))
  const level2Ids = new Set<string>()
  const level1Parents: string[] = []
  for (const v of followed) {
    if (v.level === 2) level2Ids.add(v.id)
    else if (v.level === 1) level1Parents.push(v.id)
  }
  // 展开 level-1 父 → 所有 level-2 子
  if (level1Parents.length > 0) {
    const children = await db.select({ id: vehicleClasses.id }).from(vehicleClasses)
      .where(inArray(vehicleClasses.parentId, level1Parents))
    for (const c of children) level2Ids.add(c.id)
  }
  return Array.from(level2Ids)
}
