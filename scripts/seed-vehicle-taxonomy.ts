/**
 * Plan-PP:清理 demo 车辆类型 + 种子真实业务分类(10 L1 × 5–7 L2)。
 *
 * 步骤:
 *   1. INSERT 10 个 L1 + 各自 L2(新 UUID)
 *   2. UPDATE 6 个 active 监视清单的 vehicleClassId → 新 L2(按当前 V 名匹配)
 *   3. DELETE 所有 inactive 监视清单(都是测试残留)
 *   4. DELETE 所有 vehicle_classes 中不在新种子里的旧行(此时无 FK 引用,可全删)
 *
 * 危险操作:此脚本会清掉 26000+ 车辆类型 demo 行 + 140 个测试 watchlist。
 * 已由用户授权(2026-05-11)。
 */
import { createDb } from '@/db/client'
import { sql } from 'drizzle-orm'

type L1Def = {
  name: string
  children: string[]
}

// 10 个 level-1 大类 × 5-7 个 level-2 子类(政府/公共车辆视角,围绕广州市常见调度场景)
const TAXONOMY: L1Def[] = [
  {
    name: '公安警务',
    children: ['治安巡逻车', '刑侦勘查车', '交警执法车', '特警突击车', '反恐处突车', '网安便衣车', '防暴车'],
  },
  {
    name: '应急救援',
    children: ['消防救援车', '医疗急救车', '抢险救援车', '防汛排涝车', '危化处置车', '应急指挥车', '山岳救援车'],
  },
  {
    name: '城市管理',
    children: ['城管执法车', '综治巡防车', '违建查处车', '市容稽查车', '占道经营查处车', '噪音查处车'],
  },
  {
    name: '生态环保',
    children: ['环保监察车', '空气监测车', '水质监测车', '固废清运车', '排污稽查车', '油烟监测车'],
  },
  {
    name: '市政工程',
    children: ['道路维修车', '排水抢修车', '路灯维护车', '绿化养护车', '桥梁检测车', '燃气抢修车'],
  },
  {
    name: '交通运输',
    children: ['公交督察车', '出租车稽查车', '网约车监管车', '道路货运稽查车', '高速公路巡查车', '港航执法车'],
  },
  {
    name: '市场监管',
    children: ['食品安全执法车', '药品监督车', '特种设备检查车', '计量稽查车', '价格巡查车', '广告执法车'],
  },
  {
    name: '卫生医疗',
    children: ['急救转运车', '疾控流调车', '卫生监督车', '移动核酸采样车', '突发公卫处置车'],
  },
  {
    name: '林业自然资源',
    children: ['森林防火车', '野生动植物保护车', '国土执法车', '矿产巡查车', '测绘调查车'],
  },
  {
    name: '专项保障',
    children: ['大型活动安保车', '重要会议警卫车', '应急通信车', '涉外接待保障车', '突发事件指挥车'],
  },
]

// 现有 wl V 名 → 新 L2 名 映射
const WL_V_REMAP: Record<string, string> = {
  '治安巡逻车': '治安巡逻车',     // 公安警务/治安巡逻车
  '交警执法车': '交警执法车',     // 公安警务/交警执法车
  '刑侦专项车': '刑侦勘查车',     // 公安警务/刑侦勘查车
  '城管执法车': '城管执法车',     // 城市管理/城管执法车
  '综治巡防车': '综治巡防车',     // 城市管理/综治巡防车
  '通用车辆': '大型活动安保车',   // 「广州展会-车辆搜索」→ 专项保障/大型活动安保车
}

async function main() {
  const { db } = createDb('admin')

  // Plan-PP docker:idempotent guard — 容器 entrypoint 每次启动都会调本脚本,
  // 已 seed 过则直接退出,避免重复 INSERT。
  const existing = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int as n FROM vehicle_classes
    WHERE level = 1 AND name = ANY(${'{' + TAXONOMY.map(t => `"${t.name}"`).join(',') + '}'}::text[])
  `) as unknown as Array<{ n: number }>
  if ((existing[0]?.n ?? 0) >= TAXONOMY.length) {
    console.log(`[seed-vehicle-taxonomy] already seeded (${existing[0]!.n} L1 found),skip`)
    process.exit(0)
  }

  console.log('=== Step 1: insert new L1 + L2 hierarchy ===')
  const l1Map = new Map<string, string>()  // name → id
  const l2Map = new Map<string, string>()  // name → id (level-2 一律按 name unique)
  for (const l1 of TAXONOMY) {
    const r = await db.execute<{ id: string }>(sql`
      INSERT INTO vehicle_classes (name, level) VALUES (${l1.name}, 1)
      RETURNING id::text
    `) as unknown as Array<{ id: string }>
    const l1Id = r[0]!.id
    l1Map.set(l1.name, l1Id)
    for (const childName of l1.children) {
      const c = await db.execute<{ id: string }>(sql`
        INSERT INTO vehicle_classes (name, level, parent_id) VALUES (${childName}, 2, ${l1Id}::uuid)
        RETURNING id::text
      `) as unknown as Array<{ id: string }>
      l2Map.set(childName, c[0]!.id)
    }
    console.log(`  inserted L1 ${l1.name} (${l1.children.length} children)`)
  }

  console.log('=== Step 2: re-link active watchlists to new L2 V ===')
  const activeWls = await db.execute<{ id: string; name: string; vc_name: string }>(sql`
    SELECT wl.id::text, wl.name, vc.name as vc_name
    FROM watch_lists wl
    JOIN vehicle_classes vc ON vc.id = wl.vehicle_class_id
    WHERE wl.is_active = true
  `) as unknown as Array<{ id: string; name: string; vc_name: string }>
  for (const wl of activeWls) {
    const newName = WL_V_REMAP[wl.vc_name]
    if (!newName) {
      console.log(`  ⚠ active wl ${wl.name}: V="${wl.vc_name}" 无映射,跳过(将在 step 4 被孤立)`)
      continue
    }
    const newId = l2Map.get(newName)
    if (!newId) {
      console.log(`  ⚠ ${wl.name}: 映射目标 "${newName}" 未找到`)
      continue
    }
    await db.execute(sql`UPDATE watch_lists SET vehicle_class_id = ${newId}::uuid WHERE id = ${wl.id}::uuid`)
    console.log(`  ✓ ${wl.name}: "${wl.vc_name}" → "${newName}"`)
  }

  console.log('=== Step 3: delete inactive watchlists (test 残留) ===')
  const del = await db.execute<{ id: string }>(sql`
    DELETE FROM watch_lists WHERE is_active = false RETURNING id::text
  `) as unknown as Array<{ id: string }>
  console.log(`  deleted ${del.length} inactive watchlists`)

  console.log('=== Step 4: delete all vehicle_classes NOT in new taxonomy ===')
  const keepIds = [...l1Map.values(), ...l2Map.values()]
  // Postgres array literal:'{uuid,uuid,...}'
  const arrLit = '{' + keepIds.join(',') + '}'
  // 先删 L2(可能 reference L1) → 再删 L1。但我们的新 L2 也在 keepIds 里,可一次清。
  // FK 约束:vehicle_classes.parent_id RESTRICT。所以先删孤儿 L2,再删孤儿 L1。
  // 把删除拆成两步:先删 level=2 不在 keep 的,再删 level=1 不在 keep 的。
  const delL2 = await db.execute<{ id: string }>(sql`
    DELETE FROM vehicle_classes WHERE level = 2 AND id <> ALL(${arrLit}::uuid[])
    RETURNING id::text
  `) as unknown as Array<{ id: string }>
  console.log(`  deleted ${delL2.length} stale level-2 rows`)
  const delL1 = await db.execute<{ id: string }>(sql`
    DELETE FROM vehicle_classes WHERE level = 1 AND id <> ALL(${arrLit}::uuid[])
    RETURNING id::text
  `) as unknown as Array<{ id: string }>
  console.log(`  deleted ${delL1.length} stale level-1 rows`)
  const after = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int as n FROM vehicle_classes
  `) as unknown as Array<{ n: number }>
  console.log(`  vehicle_classes remaining: ${after[0]!.n} (expected ${keepIds.length})`)

  console.log('=== Done ===')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
