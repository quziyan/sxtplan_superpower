import type { OssAdapter } from './oss-adapter'
import { AliyunOssAdapter } from './adapters/aliyun-oss'
import { MockOssAdapter } from './adapters/mock-oss'
import { loadEnv } from '@/env'

/**
 * OssAdapter pool — singleton selector driven by env.OSS_ADAPTER_KEY.
 *
 * Mirrors the dispatch/adapter-pool pattern (m3 T09): one process-global
 * adapter instance, lazy-initialized on first access. Tests mutate
 * env then call resetOssAdapterForTests() before re-init.
 *
 * Adapter contract: see `src/media/oss-adapter.ts`.
 * Adapters: AliyunOssAdapter (production) | MockOssAdapter (tests/demo).
 */
let _adapter: OssAdapter | null = null

/**
 * Initialize (or return) the singleton OssAdapter from current env.
 *
 * - OSS_ADAPTER_KEY=mock   → MockOssAdapter (no extra config required)
 * - OSS_ADAPTER_KEY=aliyun → AliyunOssAdapter (requires the 4 OSS_* vars;
 *   the AliyunOssAdapter constructor throws on empty endpoint/AK/secret/bucket)
 */
export function initOssAdapter(): OssAdapter {
  if (_adapter) return _adapter
  const env = loadEnv()
  switch (env.OSS_ADAPTER_KEY) {
    case 'mock':
      _adapter = new MockOssAdapter()
      break
    case 'aliyun':
      _adapter = new AliyunOssAdapter({
        endpoint: env.OSS_ENDPOINT,
        accessKeyId: env.OSS_ACCESS_KEY_ID,
        accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
        bucket: env.OSS_BUCKET,
      })
      break
    default: {
      // exhaustiveness guard — zod enum should have caught this already
      const exhaustive: never = env.OSS_ADAPTER_KEY
      throw new Error(`unknown OSS_ADAPTER_KEY: ${exhaustive as string}`)
    }
  }
  return _adapter
}

/** Lazy accessor — initializes on first call, returns cached instance after. */
export function getOssAdapter(): OssAdapter {
  if (!_adapter) return initOssAdapter()
  return _adapter
}

/**
 * Test helper: clears the singleton so the next get/init reads env afresh.
 * Pair with resetEnvCacheForTests() + process.env mutation to switch backends
 * mid-suite. Production code should never call this.
 */
export function resetOssAdapterForTests(): void {
  _adapter = null
}
