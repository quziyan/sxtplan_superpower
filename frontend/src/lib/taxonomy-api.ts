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
