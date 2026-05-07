import type { OssAdapter } from '@/media/oss-adapter'

/**
 * Recording OssAdapter stub for tests.
 *
 * Replaces the legacy `putObject` DI pattern (m3 T11) used before the
 * OssAdapter unification (cnp-adapters-unify T4). Each call to `put`
 * is appended to `_calls` so tests can assert key + size without
 * touching real OSS or even MockOssAdapter's in-memory store.
 *
 * `getStream` / `signedUrl` are intentionally throwers — fetcher.ts
 * only calls `put`; if a future test path exercises them, the failure
 * surfaces immediately rather than silently returning undefined data.
 */
export type RecordedOssCall = { key: string; size: number }

export type OssStub = OssAdapter & {
  /** Per-instance call log. Resets only when a fresh stub is constructed. */
  _calls: RecordedOssCall[]
  /** URI prefix used in synthesized return values (default: `stub://`). */
  _uriPrefix: string
}

/**
 * Build a fresh recording OssAdapter stub. Each test should construct
 * its own (don't share — the `_calls` log is mutable state).
 */
export function makeOssStub(uriPrefix = 'stub://'): OssStub {
  const calls: RecordedOssCall[] = []
  const stub: OssStub = {
    key: 'mock',
    _calls: calls,
    _uriPrefix: uriPrefix,
    async put(k: string, body: Buffer): Promise<{ uri: string; sizeBytes: number }> {
      calls.push({ key: k, size: body.byteLength })
      return { uri: `${uriPrefix}${k}`, sizeBytes: body.byteLength }
    },
    async getStream(): Promise<NodeJS.ReadableStream> {
      throw new Error('oss-stub: getStream() not used in this test path')
    },
    async signedUrl(): Promise<string> {
      throw new Error('oss-stub: signedUrl() not used in this test path')
    },
  }
  return stub
}
