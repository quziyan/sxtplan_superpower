import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createRegion, getRegion, updateAdminRegionGeom } from '@/modules/region/service'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly = (x: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, 30], [x + 1, 30], [x + 1, 31], [x, 31], [x, 30]]],
})

describe('region service', () => {
  test('create ADMIN_NAMED + getRegion returns current', async () => {
    const r = await createRegion(ctx.db, { kind: 'ADMIN_NAMED', name: `测试区A-${Date.now()}`, geom: poly(120) })
    expect(r.version).toBe(1)
    const got = await getRegion(ctx.db, r.id)
    expect(got.name).toBe(r.name)
  })

  test('update ADMIN_NAMED appends version=2 + closes v1', async () => {
    const r = await createRegion(ctx.db, { kind: 'ADMIN_NAMED', name: `测试区B-${Date.now()}`, geom: poly(122) })
    const updated = await updateAdminRegionGeom(ctx.db, { id: r.id, geom: poly(123) })
    expect(updated.version).toBe(2)
    const v1 = await getRegion(ctx.db, r.id, 1)
    expect(v1.effectiveTo).not.toBeNull()
  })

  test('AD_HOC immutable: update throws', async () => {
    const r = await createRegion(ctx.db, { kind: 'AD_HOC', geom: poly(124) })
    await expect(updateAdminRegionGeom(ctx.db, { id: r.id, geom: poly(125) })).rejects.toThrow(/immutable/)
  })

  test('open polygon rejected', async () => {
    await expect(createRegion(ctx.db, {
      kind: 'AD_HOC',
      geom: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }, // 没闭合
    })).rejects.toThrow(/not closed/)
  })
})
