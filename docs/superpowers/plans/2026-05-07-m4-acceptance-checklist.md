# m4 Acceptance Checklist

> Generated 2026-05-08. m4 plan: `docs/superpowers/plans/2026-05-07-m4-real-customer-onboarding.md`
> m4 spec: `docs/superpowers/specs/2026-05-07-m4-real-customer-onboarding-design.md`
> Commit range: `2a41002..HEAD` (24 task commits + 3 fixups + spec/plan = 27 commits)

Status legend:

- ✅ **PASS** — internal/code-only ISC, satisfied by a commit on `main`
- ⏳ **DEFERRED-VERIFY** — real-network/customer-credential ISC, can only be verified at deploy time with live credentials. Code path + offline test + flag are landed; flip the flag when credentials arrive.
- ❌ **FAIL** — not landed (none of these in m4)

---

## Section 0 — Cross-Cutting (CC)

These are the global gates the whole m4 plan rides on. The "commit" column lists the head of `main` after the last m4 task; the gates are checked across the full series, not pinned to any single commit.

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-CC1 (`bun test` ≥ 380, target 348 + ≥30 new) | ✅ PASS | head `d543030` | 389 pass / 1 skip / 0 fail (41 above the 348 baseline) |
| ISC-CC2 (`bunx tsc --noEmit` zero errors) | ✅ PASS | head `d543030` | clean every commit (verified at each task) |
| ISC-CC3 (no m3 / cnp-adapters-unify baseline regression) | ✅ PASS | head `d543030` | All 348 baseline tests still green; new failures = 0 |
| ISC-CC4 (each task independent commit + explicit `git add`) | ✅ PASS | range `2a41002..HEAD` | 24 task commits + 3 review-feedback fixups, each named per plan |

---

## Section 1 — C 桶清债 (重构债务)

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-C1 (logAudit `Db ∣ PgTransaction`) | ✅ PASS | `7c2ccae` | union signature lets transactional callers reuse the helper |
| ISC-C2 (test-db tx isolation demo) | ✅ PASS | `7c6647f` | Option C escape valve; BEGIN/ROLLBACK + SAVEPOINT nesting compatible |
| ISC-C3 (createBullMQWorker helper) | ✅ PASS | `2456e18` | 5 BullMQ worker call-sites retrofitted |
| ISC-C4 (DEFAULT_ADAPTER_KEY) | ✅ PASS | `aa5ee1c` + `52b4642` | env-driven priority chain; 2 env-dep tests hardened by post-review fixup |
| ISC-C5 (GET /retrospectives/aggregate) | ✅ PASS | `b537ac6` + `351739c` | server-side GROUP BY; MatrixTab toggled to use it; count-delta semantics fixed in review fixup |

---

## Section 2 — A1 真 Camera Adapter

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-A1.1 (customer-camera-api spec draft + 客户审核记录) | ✅ PASS *(draft)* / ⏳ *(sign-off)* | `3e5a39b` | spec committed as DRAFT; awaiting customer sign-off (EX-7 in plan-D). Sign-off record will land in followup commit. |
| ISC-A1.2 (RealGuangzhouPoliceCamAdapter + e2e parity) | ✅ PASS | `f3eecf7` + `faeb8d6` + `885e75e` + `61856f2` | adapter implementation, post-review fixup (cancel body + dropped unrequested X-Signature), webhook flow advance test, m4 e2e full-flow |
| ISC-A1.3 (CAMERA_BACKEND_KIND env switch — simulated/real swap) | ✅ PASS | `cf5b474` | adapter pool registers real-gzp factory; env-driven `alsoRegister` |

---

## Section 3 — A2-α Bing News 真接入

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-A2α.1 (real API + rate-limit + fallback + degraded flag) | ✅ PASS | `569f4f4` | BingNewsSearchAdapter real API path, 3/sec rate-limit, 24h cache, degraded fallback when key empty |
| ISC-A2α.2 (unit tests cover happy / rate-limit / fallback) | ✅ PASS | `569f4f4` | 4 path tests committed alongside the adapter |

---

## Section 4 — A2-γ 政务网爬虫

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-A2γ.1 (GovScraperBaseAdapter + robots.txt + retry + dedupe) | ✅ PASS | `5dbc027` | base class with cheerio + robots.txt + token-bucket rate limit |
| ISC-A2γ.2 (GovGdProvinceAdapter) | ✅ PASS | `1b15f14` | 广东省政府公示 |
| ISC-A2γ.3 (GovGzCityAdapter) | ✅ PASS | `707e537` | 广州市政府公示 |
| ISC-A2γ.4 (GovPublicSecurityAdapter + 失败隔离 e2e) | ✅ PASS | `102f940` + `9337bab` | 公安厅 adapter + isolation test (one site 500 不影响其他) |

---

## Section 5 — B1 自动撤单

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-B1.1 (scheduler tick + SQL + auto_cancel_disabled migration) | ✅ PASS | `68b9000` + `55b234f` | DB migration 0009 columns; tick query joins predictions ↔ dispatch_tasks |
| ISC-B1.2 (threshold / lag / notify env config + audit log) | ✅ PASS | `55b234f` + `5ee4bda` | 3 env keys with defaults; AUTO_CANCEL_DISPATCH audit row written; inbox notification helper landed |
| ISC-B1.3 (unit + e2e — confidence drop → cancel + audit + inbox) | ✅ PASS | `6645155` | dedicated e2e exercises both phases (above + below threshold) |

---

## Section 6 — Integration Acceptance

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-INT.1 (m4 e2e full-flow) | ✅ PASS | `61856f2` | real-gzp dispatch + signed webhook IN_PROGRESS+COMPLETED + auto-cancel tick all in one test; partial coverage of media-fetch + retro deferred to m3-full-flow (documented in test header) |
| ISC-INT.2 (README m4 section) | ✅ PASS | `d543030` | env table + flow diagram + Slice 1 pointer + C-debt summary |
| ISC-INT.3 (acceptance checklist + Slice 1 runbook) | ✅ PASS | `(this commit)` + T24 commit | this file + `docs/demo/slice-1-runbook.md` |

---

## Section 7 — Anti-Goals

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-Anti.1 (m4 changes do not break any m3 / cnp-adapters-unify tests) | ✅ PASS | head `d543030` | full suite green; no test in m3-full-flow / dispatch / news / retrospective baseline files modified to mask failures |
| ISC-Anti.2 (`--integration` flag OFF → m4 e2e calls no external API) | ✅ PASS | `71da290` | `INTEGRATION_TESTS` env gate via `describe.skipIf`; default `bun test` skips. `m4-full-flow.test.ts` uses stubbed `globalThis.fetch` for the same reason. |
| ISC-Anti.3 (B1 auto-cancel idempotent — no double-cancel of same dispatch) | ✅ PASS | `55b234f` | tick SQL filters `state IN ('QUEUED','SENT','IN_PROGRESS')`; CANCEL_PENDING / CANCELLED rows excluded by predicate, so re-tick is a no-op |

---

## Real-credential prerequisites (DEFERRED-VERIFY items in detail)

These are flows whose code path is landed and offline-tested, but whose *live* execution requires credentials that don't exist in this repo. The acceptance gate is "code is correct; flip the flag at deploy time."

### EX-7 — customer-camera-api spec sign-off

- **Owner:** customer's IT integration lead (EX-7 in plan-D)
- **Pending artifact:** signed PDF / wet-ink copy of `docs/integrations/customer-camera-api-v0.1.md` returned by customer
- **What's already landed:** spec at `docs/integrations/customer-camera-api-v0.1.md` committed `3e5a39b`, marked DRAFT
- **What's still owed:** add a sign-off record to the spec (or alongside it) once received; bump status DRAFT → ACCEPTED

### EX-8 — REAL_GZP_API_KEY + REAL_GZP_BACKEND_URL

- **Owner:** customer's deployment team
- **Pending artifact:** API key string + production backend URL
- **What's already landed:** env keys + zod schema with sane defaults; adapter pool registers `real-gzp` when `CAMERA_BACKEND_KIND=real-gzp`
- **What's still owed:** at deploy time, export both env vars + run `bun run test:integration` to exercise `tests/integrations/real-gzp-acceptance.test.ts` (currently `describe.skipIf(!INTEGRATION_TESTS)`); confirms a `[TEST]`-prefixed dispatch + immediate cancel round-trip succeed against the live backend

### BING_NEWS_API_KEY

- **Owner:** ops (Bing API quota application)
- **Pending artifact:** Azure Bing Search v7 API key + remaining quota check
- **What's already landed:** `BingNewsSearchAdapter` (commit `569f4f4`) — when key is empty, adapter returns degraded `[]` (logged); rate-limit + 24h cache active when key is set
- **What's still owed:** at deploy time, set `BING_NEWS_API_KEY=...` and confirm `curl https://api.bing.microsoft.com/v7.0/news/search?q=test -H "Ocp-Apim-Subscription-Key: $BING_NEWS_API_KEY"` returns 200 with results

### Gov scraper sites — robots.txt + accessibility

- **Owner:** ops + content team (selectors are offline guesses per Tasks 13-15)
- **Pending artifact:** verified CSS selectors against real `gd.gov.cn` / `gz.gov.cn` page DOMs
- **What's already landed:** 3 gov adapters with robots.txt check + token-bucket + cheerio extraction + per-site failure isolation (commits `5dbc027` → `9337bab`)
- **What's still owed:** before flipping `GOV_SCRAPER_ENABLED=true` in production, manually verify each site's robots.txt allows our path + the configured selectors still match the live page structure (sites may have re-themed since spec time)

---

## Final test count

| Stage | Pass | Skip | Fail | Total |
|-------|------|------|------|-------|
| Baseline (post cnp-adapters-unify, pre-m4) | 348 | 0 | 0 | 348 |
| After m4 series (head `d543030`) | 389 | 1 | 0 | 390 |
| Delta | +41 | +1 | 0 | +42 |

The skipped test is `tests/integrations/real-gzp-acceptance.test.ts` (gated by `INTEGRATION_TESTS=true` env); it is intentionally skipped in default runs and exercised only at deploy time with real customer credentials (ISC-Anti.2).

---

## Followup (m5 / out-of-scope per spec § 3)

- A2-β NewsAPI 真接入(spec deferred — Bing-only sufficed for Slice 1)
- A1.4 Multi-region camera backend selection by `regions.kind` heuristic
- B2 confidence-now staleness detection (separate from B1 auto-cancel)
- Production observability hooks for the 3 gov adapters (currently minimal logging)
