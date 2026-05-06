import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { loadEnv } from '@/env'
import * as schema from './schema'

export type DbConnectionKind = 'app' | 'admin'

export function createDb(kind: DbConnectionKind = 'app') {
  const env = loadEnv()
  const url = kind === 'admin' ? env.DATABASE_ADMIN_URL : env.DATABASE_URL
  const sql = postgres(url, { max: kind === 'admin' ? 2 : 10, prepare: false })
  return { db: drizzle(sql, { schema }), sql }
}

export type Db = ReturnType<typeof createDb>['db']
