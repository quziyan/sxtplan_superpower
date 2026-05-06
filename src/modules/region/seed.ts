import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'

type AdminFeature = GeoJSON.Feature<GeoJSON.Polygon, {
  name: string
  adcode: string
  level: 1 | 2 | 3 | 4
  parent_adcode?: string
}>

async function loadSeed(file: string): Promise<AdminFeature[]> {
  const raw = await readFile(file, 'utf8')
  const fc = JSON.parse(raw) as GeoJSON.FeatureCollection<GeoJSON.Polygon, AdminFeature['properties']>
  return fc.features as AdminFeature[]
}

async function main() {
  const file = process.argv[2] ?? path.resolve('./seeds/region/china-admin-l1-l4.geojson')
  console.log(`[seed:region] reading ${file}`)
  const features = await loadSeed(file)
  console.log(`[seed:region] loaded ${features.length} features`)

  const { db, sql: pg } = createDb('admin')
  const adcodeToId = new Map<string, string>()

  for (const level of [1, 2, 3, 4] as const) {
    const slice = features.filter((f) => f.properties.level === level)
    for (const f of slice) {
      const parentId = f.properties.parent_adcode ? adcodeToId.get(f.properties.parent_adcode) ?? null : null
      const result = await db.execute<{ id: string }>(sql`
        INSERT INTO regions (kind, name, parent_id, version, geom)
        SELECT 'ADMIN_NAMED', ${f.properties.name}, ${parentId}::uuid, 1, ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)})
        WHERE NOT EXISTS (
          SELECT 1 FROM regions
          WHERE name = ${f.properties.name}
            AND ${parentId === null ? sql`parent_id IS NULL` : sql`parent_id = ${parentId}::uuid`}
            AND effective_to IS NULL
        )
        RETURNING id
      `)
      if (result[0]) adcodeToId.set(f.properties.adcode, (result[0] as { id: string }).id)
      else {
        const existing = await db.execute<{ id: string }>(sql`
          SELECT id FROM regions
          WHERE name = ${f.properties.name}
            AND ${parentId === null ? sql`parent_id IS NULL` : sql`parent_id = ${parentId}::uuid`}
            AND effective_to IS NULL
        `)
        if (existing[0]) adcodeToId.set(f.properties.adcode, (existing[0] as { id: string }).id)
      }
    }
    console.log(`[seed:region] level ${level} done (${slice.length} features)`)
  }
  await pg.end()
  console.log(`[seed:region] complete. mapped ${adcodeToId.size} adcodes.`)
}

main().catch((err) => { console.error('[seed:region] failed:', err); process.exit(1) })
