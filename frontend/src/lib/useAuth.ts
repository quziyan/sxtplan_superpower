import { useCallback, useEffect, useState } from 'react'
import type { RoleKey } from '@/components/topbar/RoleTabs'
import { type AuthMe, getMe, logout as apiLogout, setRoleState } from './auth'

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authed'; me: AuthMe }

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    const me = await getMe()
    setState(me ? { status: 'authed', me } : { status: 'anonymous' })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const switchRole = useCallback(async (k: RoleKey | null) => {
    await setRoleState(k)
    await refresh()
  }, [refresh])

  const doLogout = useCallback(async () => {
    await apiLogout()
    await refresh()
  }, [refresh])

  return { state, refresh, switchRole, logout: doLogout }
}
