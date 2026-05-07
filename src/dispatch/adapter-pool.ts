import type { CameraAdapter } from './types'
import { MockCameraAdapter } from './adapters/mock'

const adapters = new Map<string, CameraAdapter>()

export function registerAdapter(adapter: CameraAdapter): void {
  adapters.set(adapter.key, adapter)
}

export function getAdapter(key: string): CameraAdapter {
  const a = adapters.get(key)
  if (!a) throw new Error(`adapter '${key}' not registered`)
  return a
}

// Auto-register the mock at module load
registerAdapter(new MockCameraAdapter())
