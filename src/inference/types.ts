export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }

export type InferenceRequest = {
  messages: Message[]
  temperature?: number
  responseFormat?: 'json_object' | 'text'
  maxTokens?: number
}

export type InferenceResponse = {
  text: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  model: string
}

export class InferenceError extends Error {
  constructor(public readonly kind: 'NETWORK' | 'API' | 'TIMEOUT' | 'PARSE', msg: string) {
    super(msg)
  }
}
