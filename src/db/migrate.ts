import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './client'

async function runManualMigrations(sql: ReturnType<typeof createDb>['sql']) {
  const dir = path.resolve('./migrations/manual')
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  } catch {
    return
  }
  for (const f of files) {
    const content = await readFile(path.join(dir, f), 'utf8')
    console.log(`[migrate] manual: ${f}`)
    await sql.unsafe(content)
  }
}

async function main() {
  const { db, sql } = createDb('admin')
  await runManualMigrations(sql)
  console.log('[migrate] running drizzle migrations from ./migrations')
  await migrate(db, { migrationsFolder: './migrations' })
  await sql.end()
  console.log('[migrate] done')
}

main().catch((err) => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
