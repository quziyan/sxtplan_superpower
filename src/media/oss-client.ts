import OSS from 'ali-oss'
import { loadEnv } from '@/env'

let _client: OSS | null = null

export function getOssClient(): OSS {
  if (_client) return _client
  const env = loadEnv()
  if (!env.OSS_ENDPOINT || !env.OSS_ACCESS_KEY_ID) {
    throw new Error(
      'OSS not configured; set OSS_ENDPOINT/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET/OSS_BUCKET',
    )
  }
  _client = new OSS({
    endpoint: env.OSS_ENDPOINT,
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    bucket: env.OSS_BUCKET,
  })
  return _client
}

export async function putObject(
  key: string,
  body: Buffer | NodeJS.ReadableStream,
): Promise<{ uri: string }> {
  const client = getOssClient()
  await client.put(key, body as never)
  const env = loadEnv()
  return { uri: `oss://${env.OSS_BUCKET}/${key}` }
}

export async function getSignedUrl(key: string, ttlSeconds = 3600): Promise<string> {
  const client = getOssClient()
  return client.signatureUrl(key, { expires: ttlSeconds })
}

/** Test-only: clears the cached singleton so tests can re-enter the config-validation path. */
export function _resetOssClientForTests(): void {
  _client = null
}
