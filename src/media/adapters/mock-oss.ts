import { Readable } from 'node:stream'
import type { OssAdapter } from '@/media/oss-adapter'

/**
 * In-memory OSS adapter for tests + local demo.
 *
 * Object bodies live in a per-instance Map<key, Buffer>; signedUrl returns a
 * predictable localhost path so the demo server can serve them statically. The
 * `_clear` / `_has` / `_getRaw` helpers exist for tests only — prefixed with `_`
 * to flag non-contract surface.
 */
export class MockOssAdapter implements OssAdapter {
  readonly key = 'mock' as const

  private readonly store = new Map<string, Buffer>()
  private readonly bucket = 'mock-bucket'

  async put(k: string, body: Buffer): Promise<{ uri: string; sizeBytes: number }> {
    this.store.set(k, body)
    return {
      uri: `mock://${this.bucket}/${k}`,
      sizeBytes: body.byteLength,
    }
  }

  async getStream(k: string): Promise<NodeJS.ReadableStream> {
    const buf = this.store.get(k)
    if (!buf) {
      throw new Error(`MockOssAdapter: key not found: ${k}`)
    }
    return Readable.from(buf)
  }

  async signedUrl(k: string, _ttlSeconds = 3600): Promise<string> {
    if (!this.store.has(k)) {
      throw new Error(`MockOssAdapter: key not found: ${k}`)
    }
    return `http://localhost:3000/static/mock-oss/${encodeURIComponent(k)}`
  }

  async list(prefix = ''): Promise<string[]> {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix))
  }

  async delete(k: string): Promise<void> {
    this.store.delete(k)
  }

  // ─── test helpers (non-contract; underscore-prefixed) ───────────────────────

  /** Test-only: drops every stored object. */
  _clear(): void {
    this.store.clear()
  }

  /** Test-only: existence probe without throwing. */
  _has(k: string): boolean {
    return this.store.has(k)
  }

  /** Test-only: raw buffer access (skips the stream wrapper). */
  _getRaw(k: string): Buffer | undefined {
    return this.store.get(k)
  }
}
