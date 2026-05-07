import type { CameraAdapter } from './types'
import { MockCameraAdapter } from './adapters/mock'
import { SimulatedGuangzhouPoliceCamAdapter } from './adapters/simulated-gzp'
import { loadEnv } from '@/env'

const adapters = new Map<string, CameraAdapter>()

export function registerAdapter(adapter: CameraAdapter): void {
  adapters.set(adapter.key, adapter)
}

export function getAdapter(key: string): CameraAdapter {
  const a = adapters.get(key)
  if (!a) throw new Error(`adapter '${key}' not registered`)
  return a
}

/**
 * Initialize the adapter pool from current env. Called at module load,
 * and re-callable from tests after env mutation + resetEnvCacheForTests().
 */
export function initAdapterPool(): void {
  adapters.clear()
  registerAdapter(new MockCameraAdapter())

  const env = loadEnv()
  if (env.SIMULATED_GZP_ENABLED === 'true') {
    registerAdapter(
      new SimulatedGuangzhouPoliceCamAdapter({
        apiKey: env.SIMULATED_GZP_API_KEY,
        webhookSecret: env.WEBHOOK_HMAC_SECRET,
        webhookUrl: env.SIMULATED_GZP_WEBHOOK_URL,
        fakeMediaBaseUrl: env.SIMULATED_GZP_FAKE_MEDIA_BASE,
        inProgressDelayMs: 5000,
        completedDelayMs: 30000,
        cancelDelayMs: 5000,
      }),
    )
  }
}

/** Test helper: clears the pool. Pair with resetEnvCacheForTests() then call initAdapterPool(). */
export function resetAdapterPoolForTests(): void {
  adapters.clear()
}

// Auto-initialize at module load (registers Mock + optionally simulated-gzp)
initAdapterPool()
