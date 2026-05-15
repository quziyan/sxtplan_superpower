import { api } from './api'

// Mirrors the backend rows from /taxonomy/vehicles and /taxonomy/tasks.
// Both vehicleClasses and taskClasses share the same shape (level 1 = 大类,
// level 2 = 子类, parentId set on level 2). The backend orders by level then
// name, which is what pickers want by default.
export type VehicleClass = {
  id: string
  parentId: string | null
  name: string
  level: 1 | 2
  description: string | null
  createdAt: string
}

export type TaskClass = {
  id: string
  parentId: string | null
  name: string
  level: 1 | 2
  description: string | null
  createdAt: string
}

export async function listVehicleClasses(): Promise<VehicleClass[]> {
  return api<VehicleClass[]>('/taxonomy/vehicles')
}

export async function listTaskClasses(): Promise<TaskClass[]> {
  return api<TaskClass[]>('/taxonomy/tasks')
}

// Plan-PP — vehicle class CRUD(ADMIN gated;non-admin 调会拿 403)
export async function createVehicleClass(input: {
  name: string
  level: 1 | 2
  parentId?: string
  description?: string
}): Promise<VehicleClass> {
  return api<VehicleClass>('/taxonomy/vehicles', { method: 'POST', body: JSON.stringify(input) })
}

export async function updateVehicleClass(id: string, input: {
  name?: string
  description?: string | null
}): Promise<VehicleClass> {
  return api<VehicleClass>(`/taxonomy/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export async function deleteVehicleClass(id: string): Promise<{ ok?: boolean; error?: { code: string; message: string } }> {
  return api(`/taxonomy/vehicles/${id}`, { method: 'DELETE' })
}

// Plan-PP — per-user followed vehicle classes
export async function getFollowedVehicleClasses(): Promise<string[]> {
  const r = await api<{ ids: string[] }>('/taxonomy/me/followed-vehicles')
  return r.ids
}
export async function followVehicleClass(id: string): Promise<void> {
  await api(`/taxonomy/me/followed-vehicles/${id}`, { method: 'POST' })
}
export async function unfollowVehicleClass(id: string): Promise<void> {
  await api(`/taxonomy/me/followed-vehicles/${id}`, { method: 'DELETE' })
}
