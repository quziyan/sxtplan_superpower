import { describe, expect, test } from 'bun:test'
import { infer } from '@/inference/client'
import { InferenceError } from '@/inference/types'
import { resetEnvCacheForTests } from '@/env'

const HAS_KEY = !!process.env.LLM_API_KEY && process.env.LLM_API_KEY.startsWith('sk-')

describe.skipIf(!HAS_KEY)('inference client (real dashscope)', () => {
  test('roundtrip', async () => {
    const r = await infer({
      messages: [{ role: 'user', content: 'Reply with the single character: A. Nothing else.' }],
      temperature: 0,
      maxTokens: 10,
    })
    expect(r.text.length).toBeGreaterThan(0)
    expect(r.totalTokens).toBeGreaterThan(0)
    expect(r.model).toBeTruthy()
  }, 60_000)
})

describe('inference client (no key)', () => {
  test('throws InferenceError when API key missing', async () => {
    const orig = process.env.LLM_API_KEY
    process.env.LLM_API_KEY = ''
    resetEnvCacheForTests()
    try {
      await expect(infer({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(InferenceError)
    } finally {
      if (orig !== undefined) process.env.LLM_API_KEY = orig
      resetEnvCacheForTests()
    }
  })
})
