import { loadEnv } from '@/env'

/**
 * Plan-D Task 4 / ISC-C4 — env-driven default Camera adapter key.
 *
 * Determines the currently-active default Camera adapter key by inspecting:
 *   1. `CAMERA_BACKEND_KIND` (m4 — first-class selector: real-gzp / simulated-gzp / mock)
 *   2. `SIMULATED_GZP_ENABLED=true` (m3 legacy flag → simulated-gzp)
 *   3. fallback: `mock`
 *
 * Exposed as a function (NOT a const) so each call re-reads the env. This
 * lets tests mutate `process.env` + `resetEnvCacheForTests()` and observe
 * the new default immediately, without restarting the process or
 * re-importing the module.
 */
export function getDefaultAdapterKey(): string {
  const env = loadEnv()
  // m4 priority: CAMERA_BACKEND_KIND > SIMULATED_GZP_ENABLED > default mock
  if (env.CAMERA_BACKEND_KIND === 'real-gzp') return 'real-gzp'
  if (env.CAMERA_BACKEND_KIND === 'simulated-gzp') return 'simulated-gzp'
  if (env.CAMERA_BACKEND_KIND === 'mock') return 'mock'
  if (env.SIMULATED_GZP_ENABLED === 'true') return 'simulated-gzp'
  return 'mock'
}
