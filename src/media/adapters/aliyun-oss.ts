import OSS from 'ali-oss'
import { NotImplementedError, type OssAdapter } from '@/media/oss-adapter'

export type AliyunOssConfig = {
  endpoint: string
  accessKeyId: string
  accessKeySecret: string
  bucket: string
}

/**
 * Production OSS backend — wraps the `ali-oss` SDK.
 *
 * Mirrors the constructor + put / signatureUrl logic from `src/media/oss-client.ts`
 * (m3 T10). We hold a single internal client per adapter instance — matches the
 * legacy module-level singleton behavior, but scoped to the adapter so multiple
 * configs (e.g. region failover) are possible later without global mutation.
 *
 * `list` intentionally throws NotImplementedError — production listing should go
 * through the OSS web console, not the application code path.
 */
export class AliyunOssAdapter implements OssAdapter {
  readonly key = 'aliyun' as const

  private readonly client: OSS
  private readonly bucket: string

  constructor(config: AliyunOssConfig) {
    if (!config.endpoint) {
      throw new Error('AliyunOssAdapter: endpoint is required')
    }
    if (!config.accessKeyId) {
      throw new Error('AliyunOssAdapter: accessKeyId is required')
    }
    if (!config.accessKeySecret) {
      throw new Error('AliyunOssAdapter: accessKeySecret is required')
    }
    if (!config.bucket) {
      throw new Error('AliyunOssAdapter: bucket is required')
    }

    this.bucket = config.bucket
    this.client = new OSS({
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      bucket: config.bucket,
    })
  }

  async put(key: string, body: Buffer): Promise<{ uri: string; sizeBytes: number }> {
    await this.client.put(key, body as never)
    return {
      uri: `oss://${this.bucket}/${key}`,
      sizeBytes: body.byteLength,
    }
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    // ali-oss returns { stream, res } — `stream` is typed `any` upstream, so we narrow here.
    const result = await this.client.getStream(key)
    return result.stream as NodeJS.ReadableStream
  }

  async signedUrl(key: string, ttlSeconds = 3600): Promise<string> {
    // signatureUrl is sync in ali-oss; wrap in async to match the OssAdapter contract.
    return this.client.signatureUrl(key, { expires: ttlSeconds })
  }

  async list(_prefix?: string): Promise<string[]> {
    throw new NotImplementedError(
      'list not supported on AliyunOssAdapter — use OSS console',
    )
  }
}
