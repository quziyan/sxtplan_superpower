import { describe, expect, test } from 'bun:test'
import { Readable } from 'node:stream'
import { AliyunOssAdapter } from '@/media/adapters/aliyun-oss'
import { MockOssAdapter } from '@/media/adapters/mock-oss'

async function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

describe('MockOssAdapter', () => {
  test('put stores buffer; signedUrl returns localhost static URL', async () => {
    const oss = new MockOssAdapter()
    const key = 'media/x/abc.jpg'
    const body = Buffer.alloc(100, 7)

    const { uri, sizeBytes } = await oss.put(key, body)
    expect(sizeBytes).toBe(100)
    expect(uri).toBe(`mock://mock-bucket/${key}`)

    const url = await oss.signedUrl(key)
    expect(url).toBe(`http://localhost:3000/static/mock-oss/${encodeURIComponent(key)}`)
  })

  test('getStream returns a Readable equal to the original buffer', async () => {
    const oss = new MockOssAdapter()
    const key = 'media/x/streamable.bin'
    const body = Buffer.from('hello-stream-world', 'utf8')
    await oss.put(key, body)

    const stream = await oss.getStream(key)
    expect(stream).toBeInstanceOf(Readable)
    const collected = await collectStream(stream)
    expect(collected.equals(body)).toBe(true)
  })

  test('list filters by prefix', async () => {
    const oss = new MockOssAdapter()
    const buf = Buffer.from('x')
    await oss.put('media/x/a.jpg', buf)
    await oss.put('media/x/b.jpg', buf)
    await oss.put('media/x/c.jpg', buf)
    await oss.put('other/d.jpg', buf)

    const matched = await oss.list!('media/x/')
    expect(matched).toHaveLength(3)
    expect(matched.sort()).toEqual(['media/x/a.jpg', 'media/x/b.jpg', 'media/x/c.jpg'])
  })

  test('signedUrl on missing key throws', async () => {
    const oss = new MockOssAdapter()
    await expect(oss.signedUrl('missing/key.jpg')).rejects.toThrow(
      /MockOssAdapter: key not found: missing\/key\.jpg/,
    )
  })

  test('getStream on missing key throws', async () => {
    const oss = new MockOssAdapter()
    await expect(oss.getStream('missing/key.jpg')).rejects.toThrow(
      /MockOssAdapter: key not found: missing\/key\.jpg/,
    )
  })
})

describe('AliyunOssAdapter', () => {
  test('throws on empty endpoint', () => {
    expect(
      () =>
        new AliyunOssAdapter({
          endpoint: '',
          accessKeyId: 'x',
          accessKeySecret: 'y',
          bucket: 'z',
        }),
    ).toThrow(/AliyunOssAdapter:.*endpoint/i)
  })

  test('throws on empty accessKeyId', () => {
    expect(
      () =>
        new AliyunOssAdapter({
          endpoint: 'https://oss-cn-shenzhen.aliyuncs.com',
          accessKeyId: '',
          accessKeySecret: 'y',
          bucket: 'z',
        }),
    ).toThrow(/AliyunOssAdapter:.*accessKeyId/i)
  })

  test('list throws NotImplementedError', async () => {
    const oss = new AliyunOssAdapter({
      endpoint: 'https://oss-cn-shenzhen.aliyuncs.com',
      accessKeyId: 'fake-ak-id',
      accessKeySecret: 'fake-ak-secret',
      bucket: 'cnp-media-test',
    })
    // list? is optional on the interface, but AliyunOssAdapter implements-and-throws.
    expect(typeof oss.list).toBe('function')
    await expect(oss.list!()).rejects.toThrow(
      /list not supported on AliyunOssAdapter — use OSS console/,
    )
  })
})
