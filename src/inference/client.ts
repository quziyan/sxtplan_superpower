import { loadEnv } from '@/env'
import { InferenceError, type InferenceRequest, type InferenceResponse } from './types'

export async function infer(req: InferenceRequest): Promise<InferenceResponse> {
  const env = loadEnv()
  if (!env.LLM_API_KEY) {
    throw new InferenceError('API', 'LLM_API_KEY not set; set it in .env or use mock dispatcher')
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), env.LLM_TIMEOUT_MS)
  try {
    const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: req.messages,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 2048,
        ...(req.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ac.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new InferenceError('API', `LLM ${res.status}: ${body.slice(0, 200)}`)
    }
    const json = await res.json() as {
      choices: Array<{ message: { content: string } }>
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
      model: string
    }
    return {
      text: json.choices[0]?.message.content ?? '',
      promptTokens: json.usage.prompt_tokens,
      completionTokens: json.usage.completion_tokens,
      totalTokens: json.usage.total_tokens,
      model: json.model,
    }
  } catch (e) {
    if (e instanceof InferenceError) throw e
    if ((e as Error).name === 'AbortError') throw new InferenceError('TIMEOUT', 'LLM request timed out')
    throw new InferenceError('NETWORK', (e as Error).message)
  } finally {
    clearTimeout(timer)
  }
}
