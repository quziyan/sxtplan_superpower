import { eq } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { createDb } from './client'
import { roles, userRoles, users } from './schema/user'

const ROLES = [
  { key: 'DECIDER', label: '决策者' },
  { key: 'ANALYST', label: '分析师' },
  { key: 'REVIEWER', label: '复盘师' },
] as const

async function main() {
  const { db, sql } = createDb('admin')

  for (const r of ROLES) {
    const [existing] = await db.select().from(roles).where(eq(roles.key, r.key))
    if (!existing) await db.insert(roles).values(r)
  }
  console.log('[seed:bootstrap] roles ensured')

  const adminEmail = 'admin@cnp.local'
  const [existing] = await db.select().from(users).where(eq(users.email, adminEmail))
  let adminId: string
  if (existing) {
    adminId = existing.id
    console.log('[seed:bootstrap] admin already exists')
  } else {
    const [u] = await db.insert(users).values({
      email: adminEmail, displayName: 'Admin', passwordHash: await hashPassword('admin1234'),
    }).returning()
    adminId = u!.id
    console.log(`[seed:bootstrap] admin created: ${adminEmail} / admin1234`)
  }

  for (const r of ROLES) {
    const [role] = await db.select().from(roles).where(eq(roles.key, r.key))
    if (!role) continue
    const hasThisRole = (await db.select().from(userRoles)
      .where(eq(userRoles.userId, adminId))).some(ur => ur.roleId === role.id)
    if (!hasThisRole) await db.insert(userRoles).values({ userId: adminId, roleId: role.id })
  }
  console.log('[seed:bootstrap] admin assigned all roles')

  await sql.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
