# m5 News Intake Pipeline — Acceptance Checklist

> Generated 2026-05-08. m5 plan: `docs/superpowers/plans/2026-05-08-m5-news-intake.md`
> m5 spec: `docs/superpowers/specs/2026-05-08-m5-news-intake-design.md`(commit `59b8d4b`)
> Commit range: `59b8d4b..HEAD`

## Status legend

- ✅ **PASS** — code path landed,offline tests pass,no real-credential dependency
- ⏳ **DEFERRED-VERIFY** — code path landed,real-network/credential test gated behind `INTEGRATION_TESTS=true`
- ❌ **FAIL** — not landed (none of these in m5)

## Commit map (Plan-E tasks → SHAs)

| Task | SHA | Description |
|------|-----|-------------|
| Plan | `a57847b` | plan(e): m5 news intake pipeline + Tavily migration — 14 tasks, ~6-8 days |
| T1 | `fedf6cb` | fix(scheduler): cadence tick → fullRecalcQueue (G1, m5) |
| T2 | `2ff556b` | feat(db): watch_lists.keywords text[] column (m5) |
| T3 | `df9fca8` | feat(watchlist): keywords field + PATCH /:id/keywords (m5) |
| T4 | `56a8858` | feat(news): TavilySearchAdapter — REST API + rate-limit + cache + degraded fallback (m5) |
| T5 | `c5f083f` | feat(news): tavily factory + default SEARCH_API_KIND=tavily (m5) |
| T6 | `d6bfe7b` | feat(news): keyword-derive — explicit > V/T/region fallback (m5) |
| T7 | `b25b566` | feat(scheduler): tickNewsIngest worker — fetch + match + enqueue triage (G2/G4, m5) |
| T8 | `662079d` | feat(scheduler): newsTriageWorker — REAL LLM evidence + INCR enqueue (G3, m5) |
| T9 | `4f9fff6` | feat(scheduler): newsTriageQueue + ingest tick + triage worker registration (m5) |
| T10 | `69c7951` | fix(prediction): recompute-now FULL P5 default + optional INCR mode (G5, m5) |
| T11 | `abe65ff` | test(e2e): m5 news-intake full pipeline — ingest → triage → refresh (REAL LLM) |
| T12 | `1c37f88` | test(integration): tavily acceptance test gated by INTEGRATION_TESTS env (m5) |
| T13 | `d29430d` | docs(m5): README section + acceptance checklist |

## ISC Coverage

### G1 Cadence 修复
| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-G1.1 (cadence enqueue → fullRecalcQueue) | ✅ PASS | `fedf6cb` | 不再给 INCR 任务 |
| ISC-G1.2 (no `INCR mode requires newEvidenceNewsIds` error) | ✅ PASS | `fedf6cb` | 测试覆盖 |
| ISC-G1.3 (`shouldTriggerFull` 在 cadence 路径下被实际调用) | ✅ PASS | `fedf6cb` | spy 验证 |

### G2/G4 newsIngestTick + matcher
| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-G2.1 | ✅ PASS | `b25b566` | 1 wl + 1 adapter + 2 news → 2 inserted |
| ISC-G2.2 | ✅ PASS | `2ff556b` + `d6bfe7b` + `b25b566` | keywords 显式 vs 派生 fallback |
| ISC-G2.3 | ✅ PASS | `b25b566` | per-watchlist try/catch |
| ISC-G2.4 | ✅ PASS | `b25b566` | matcher 同步调用 + 候选 enqueue triage |
| ISC-G2.5 | ✅ PASS | `b25b566` | URL UNIQUE 约束 idempotent |

### G3 newsTriageWorker
| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-G3.1 | ✅ PASS | `662079d` | worker 调真 LLM dashscope deepseek-v4-flash |
| ISC-G3.2 | ✅ PASS | `662079d` | HIGH → evidence + INCR enqueue |
| ISC-G3.3 | ✅ PASS | `662079d` | MED → evidence,无 INCR |
| ISC-G3.4 | ✅ PASS | `662079d` | LOW/!relevant → no-op |
| ISC-G3.5 | ✅ PASS | `662079d` | LLM error 不阻塞队列 |

### G5 recompute-now
| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-G5.1 | ✅ PASS | `69c7951` | 默认 → fullRecalcQueue + manualTrigger=true |
| ISC-G5.2 | ✅ PASS | `69c7951` | INCR + IDs → refreshQueue INCR |
| ISC-G5.3 | ✅ PASS | `69c7951` | audit 写 recompute_now_requested |

### Tavily
| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-T.1 | ✅ PASS | `56a8858` | happy path 映射 SearchHit |
| ISC-T.2 | ✅ PASS | `56a8858` | no key → [] |
| ISC-T.3 | ✅ PASS | `56a8858` | 3/sec rate-limited |
| ISC-T.4 | ✅ PASS | `56a8858` | HTTP 500 → [] |
| Tavily real API integration | ⏳ DEFERRED-VERIFY | `1c37f88` | INTEGRATION_TESTS gate;`bun run test:integration` 启用 |

### 端到端 Anti
| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-Anti.1 | ✅ PASS | `abe65ff` + 跨 task | 默认 bun test 无外部网络;LLM 例外 |
| ISC-Anti.2 | ✅ PASS | `abe65ff` | full pipeline e2e + 全套 ≥ 409 |

## DEFERRED-VERIFY items

- **Tavily real API**: `bun run test:integration` with `TAVILY_API_KEY` set
- **真 dashscope LLM 在 CI**: 需 CI 配 `LLM_API_KEY`(本地开发已配 m2 起)

## Final test count

- Baseline (m4 final): 390 pass / 1 skip / 0 fail
- After m5: 409 pass / 2 skip / 0 fail
- New tests added: ~25
