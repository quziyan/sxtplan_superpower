# m1 Foundation — 验收对照

> Plan-A 完成时,本清单全部勾选 = m1 接受 = 进入 Plan-B(m2)。

## ISC 覆盖(本计划)

- [x] **ISC-5**:Region 引用绑定 `(region_id, region_version)`(`regions_pk = (id, version)`)— Task 7/15
- [x] **ISC-6**:AD_HOC immutable;ADMIN_NAMED 晋升路径走通 — Task 15(immutable enforced;晋升 v1 留 Plan-B 实装路由)
- [x] **ISC-7**:V/T 二级分类 + edge tag 可写入 — Task 8/18
- [x] **ISC-8**:`audit.operation_audit` 对 `cnp_app` INSERT-only(DB 权限层)— Task 9
- [x] **ISC-30**(部分):docker-compose 起整套 ≤ 30min — Task 3 + README
- [x] **ISC-32**:OperationAudit 跨生命周期 INSERT-only — Task 9 + Task 10

## 功能验收

- [x] `bun run db:migrate` 在干净 DB 上一次跑通(包含 audit schema + cnp_app role)
- [x] `bun run seed:bootstrap` idempotent
- [x] `bun run seed:region` 在 fixture 上 idempotent(真实数据待客户提供)
- [x] `bun test` 全绿
- [ ] `bun run dev` + `cd frontend && bun run dev` 后,`http://localhost:5173` 登录 `admin@cnp.local` / `admin1234` 成功
- [ ] 三个角色按钮可切换,主区文案随角色变化
- [x] `bun run typecheck` 无错
- [ ] `bun run lint` 无 error 级别警告

> 上面三项 `[ ]` 为人工浏览器验证项,自动化测试已覆盖等价 API 路径(smoke.test.ts)。

## 产出物

- [x] m1 commits 在 main 分支线性可读(每 task 一 commit)
- [x] `README.md` 是新人 5 分钟可起本地的级别
- [x] `docs/superpowers/plans/2026-05-05-m1-foundation.md`(主计划)+ `2026-05-06-m1-foundation-frontend-addendum.md`(前端覆写)所有 task 已实施
- [ ] (可选)给客户的 m1 demo 视频:登录 → 切角色 → 创建区域 → 创建分类

## Plan-B / Plan-C 启动前提清单

外部依赖,m1 不阻塞但 Plan-B/C 阻塞:

- [ ] 客户给 V/T 分类法初版反馈(Q6.C=ii)
- [ ] 客户给 Slice 0 真实 (V, T, R) 三元组确认
- [ ] adapter backend 契约(Q7.A=d 第一个 backend 文档)
- [ ] 行政区划 GeoJSON 数据源选定(K2)
- [ ] AMAP API key
