import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { vehicleClasses, vehicleEdgeTags } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

describe('taxonomy', () => {
  test('two-level hierarchy + edge tag', async () => {
    const { db } = ctx
    const suffix = Date.now()
    const [parent] = await db.insert(vehicleClasses).values({
      name: `消防车-${suffix}`, level: 1,
    }).returning()
    const [child] = await db.insert(vehicleClasses).values({
      name: `高喷消防车-${suffix}`, level: 2, parentId: parent!.id,
    }).returning()
    expect(child!.parentId).toBe(parent!.id)

    const [tag] = await db.insert(vehicleEdgeTags).values({
      vehicleClassId: child!.id, tag: `远程支援-${suffix}`,
    }).returning()
    expect(tag!.tag).toBe(`远程支援-${suffix}`)
  })

  test('CHECK rejects level=1 with parent', async () => {
    const { db } = ctx
    const suffix = Date.now()
    const [p] = await db.insert(vehicleClasses).values({ name: `父-${suffix}`, level: 1 }).returning()
    await expect(
      Promise.resolve(db.insert(vehicleClasses).values({ name: `错-${suffix}`, level: 1, parentId: p!.id }))
    ).rejects.toThrow()
  })

  test('CHECK rejects level=2 without parent', async () => {
    const { db } = ctx
    await expect(
      Promise.resolve(db.insert(vehicleClasses).values({ name: `错-no-parent-${Date.now()}`, level: 2 }))
    ).rejects.toThrow()
  })
})
