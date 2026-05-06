import { api } from './api'
import type { RoleKey } from '@/components/topbar/RoleTabs'

export type AuthMe = {
  user: { id: string; email: string; displayName: string | null }
  sessionId: string
  activeRoleKey: RoleKey | null
  availableRoles: RoleKey[]
}

export async function login(email: string, password: string) {
  return api<{ ok: boolean; userId: string }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  })
}

export async function logout() {
  return api<{ ok: boolean }>('/auth/logout', { method: 'POST' })
}

export async function getMe(): Promise<AuthMe | null> {
  try { return await api<AuthMe>('/auth/me') }
  catch { return null }
}

export async function setRoleState(roleKey: RoleKey | null) {
  return api<{ ok: boolean; activeRoleKey: RoleKey | null }>(
    '/auth/role-state', { method: 'POST', body: JSON.stringify({ roleKey }) }
  )
}
