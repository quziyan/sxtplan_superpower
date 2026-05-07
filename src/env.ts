import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().startsWith('postgres'),
  DATABASE_ADMIN_URL: z.string().url().startsWith('postgres'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(32),
  COOKIE_DOMAIN: z.string().default('localhost'),
  AMAP_API_KEY: z.string().optional(),
  DASHSCOPE_BASE_URL: z.string().url().optional(),
  DASHSCOPE_API_KEY: z.string().optional(),
  DASHSCOPE_MODEL: z.string().default('deepseek-v4-flash'),

  // --- LLM ---
  LLM_BASE_URL: z.string().url().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('deepseek-v4-flash'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // --- News Search ---
  SEARCH_API_KIND: z.enum(['mock', 'bing-news', 'rss', 'ddg', 'aggregator']).default('mock'),
  SEARCH_API_KEY: z.string().default(''),
  SEARCH_API_BASE_URL: z.string().url().default('https://api.bing.microsoft.com/v7.0/news/search'),

  // --- 高德地理编码 ---
  AMAP_GEOCODE_KEY: z.string().default(''),

  // --- Webhook ingest ---
  WEBHOOK_HMAC_SECRET: z.string().min(16).default('dev-secret-32-chars-replace-prod'),

  // --- Simulated Guangzhou Police Cam adapter (m3) ---
  SIMULATED_GZP_ENABLED: z.enum(['true', 'false']).default('false'),
  SIMULATED_GZP_API_KEY: z.string().default('test-key'),
  SIMULATED_GZP_WEBHOOK_URL: z.string().url().default('http://localhost:3000/webhook/simulated-gzp'),
  SIMULATED_GZP_FAKE_MEDIA_BASE: z.string().url().default('http://localhost:3000/static/sim-media/'),

  // --- 阿里云 OSS (m3, EX-6) ---
  OSS_ENDPOINT: z.string().default('https://oss-cn-shenzhen.aliyuncs.com'),
  OSS_ACCESS_KEY_ID: z.string().default(''),
  OSS_ACCESS_KEY_SECRET: z.string().default(''),
  OSS_BUCKET: z.string().default('cnp-media-dev'),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

export function loadEnv(): Env {
  if (cached) return cached
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`env validation failed: ${issues}`)
  }
  cached = parsed.data
  return cached
}

export function resetEnvCacheForTests() {
  cached = null
}
