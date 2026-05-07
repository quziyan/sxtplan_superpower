/**
 * OssAdapter — uniform contract for object storage backends used by the media pipeline.
 *
 * Implementations (m3+):
 *   - AliyunOssAdapter (production; wraps `ali-oss`)
 *   - MockOssAdapter   (tests / local demo; in-memory Map)
 *
 * The interface is intentionally minimal: put / getStream / signedUrl / optional list.
 * Anything richer (multi-part upload, lifecycle, CRR) belongs in a backend-specific
 * extension class — not in this contract.
 */
export interface OssAdapter {
  /** Stable identity tag — useful for logs / metrics / persisted task rows. */
  readonly key: 'aliyun' | 'mock'

  /**
   * Upload a single object body. Returns a backend-specific URI plus exact byte size
   * (callers persist sizeBytes on the MediaAsset row — m3 schema).
   */
  put(key: string, body: Buffer): Promise<{ uri: string; sizeBytes: number }>

  /** Stream an object back. Throws if not found. */
  getStream(key: string): Promise<NodeJS.ReadableStream>

  /** Pre-signed URL for short-lived public access. ttl defaults to 3600s. */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>

  /**
   * Optional: list keys with the given prefix (test/demo only).
   * AliyunOssAdapter implements-and-throws (use OSS console for production listing).
   */
  list?(prefix?: string): Promise<string[]>

  /**
   * Optional: delete a single object by key (test/demo cleanup only).
   *
   * Used by the demo-data cleanup CLI (au-T9) to clear seeded `media/demo-*`
   * objects from the in-memory MockOssAdapter. AliyunOssAdapter implements-
   * and-throws — production deletion belongs in OSS lifecycle rules / console,
   * not in this code path.
   */
  delete?(key: string): Promise<void>
}

/**
 * Sentinel error thrown by adapters when a feature is intentionally unsupported on
 * that backend (e.g. AliyunOssAdapter.list — production listing belongs in the OSS console).
 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotImplementedError'
  }
}
