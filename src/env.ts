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
  BING_NEWS_API_KEY: z.string().default(''),  // empty = degraded fallback (Plan-D Task 7)
  TAVILY_API_KEY: z.string().default(''),  // empty = degraded fallback (Plan-E Task 4)

  // --- Gov-site scrapers (Plan-D Task 12, A2-γ) ---
  // Disabled by default. Concrete subclasses (Tasks 13-15) read these URLs.
  GOV_SCRAPER_ENABLED: z.enum(['true', 'false']).default('false'),
  GOV_GD_PROVINCE_URL: z.string().url().default('https://www.gd.gov.cn/gdywdt/sxtt/'),
  GOV_GZ_CITY_URL: z.string().url().default('https://www.gz.gov.cn/zwgk/zfxxgkml/'),
  GOV_PUBLIC_SECURITY_URL: z.string().url().default('https://www.gd.gov.cn/zfxxgk/'),

  // --- 高德地理编码 ---
  AMAP_GEOCODE_KEY: z.string().default(''),

  // --- Webhook ingest ---
  WEBHOOK_HMAC_SECRET: z.string().min(16).default('dev-secret-32-chars-replace-prod'),

  // --- Camera backend selector (m4) — overrides legacy SIMULATED_GZP_ENABLED when set ---
  CAMERA_BACKEND_KIND: z.enum(['real-gzp', 'simulated-gzp', 'mock']).optional(),

  // --- Real Guangzhou Police Cam adapter (m4) — effective when CAMERA_BACKEND_KIND=real-gzp ---
  REAL_GZP_BACKEND_URL: z.string().url().default('https://camera-real.example.com.cn'),
  REAL_GZP_API_KEY: z.string().default(''),
  REAL_GZP_REQUEST_TIMEOUT_MS: z.coerce.number().default(30000),

  // --- Simulated Guangzhou Police Cam adapter (m3) ---
  SIMULATED_GZP_ENABLED: z.enum(['true', 'false']).default('false'),
  SIMULATED_GZP_API_KEY: z.string().default('test-key'),
  SIMULATED_GZP_WEBHOOK_URL: z.string().url().default('http://localhost:3000/webhook/simulated-gzp'),
  SIMULATED_GZP_FAKE_MEDIA_BASE: z.string().url().default('http://localhost:3000/static/sim-media/'),

  // --- Auto-cancel (Plan-D B1) ---
  // Tick scans dispatch_tasks whose prediction confidence dipped under
  // AUTO_CANCEL_THRESHOLD (0..1) for at least AUTO_CANCEL_LAG_MINUTES
  // (suppresses single-snapshot noise). NOTIFY toggles the DECIDER inbox push.
  AUTO_CANCEL_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
  AUTO_CANCEL_LAG_MINUTES: z.coerce.number().min(1).max(120).default(15),
  AUTO_CANCEL_NOTIFY: z.enum(['true', 'false']).default('true'),

  // --- 阿里云 OSS (m3, EX-6) ---
  OSS_ADAPTER_KEY: z.enum(['mock', 'aliyun']).default('mock'),
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
