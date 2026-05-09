/**
 * 清理 V/T/region 表中由 test fixture 留下的非中文名称污染。
 *
 * 测试 setup 通常用 `vc-${stamp}` / `v-${label}` / `NIVehicle ${stamp}`
 * 这类英文 fixture 名,跑完不清理就堆到主库。结果:分析师/决策者/复盘控制台
 * 页面里 V/T/region 列出现一堆 `v-rcn-incr-1778295773987` 之类编号。
 *
 * 此脚本检测所有 name 不完全是中文字符的 V/T/region 行,按 ID 顺序
 * 轮转分配标准警务车类 / 任务 / 广州区域名,UPDATE 不动 ID(预测仍指向
 * 同一行),只换显示名。
 *
 * 用法:`bun src/scripts/clean-fixture-pollution.ts`
 */
import postgres from 'postgres'

const VEHICLE_CANONICAL = ['治安巡逻车', '交警执法车', '刑侦专项车', '综治巡防车', '城管执法车']
const TASK_CANONICAL = ['街面治安巡逻', '路面交通执法', '专项行动', '综合治理巡查', '城管执法巡查']
const REGION_CANONICAL = [
  '广州市天河区', '广州市海珠区', '广州市番禺区', '广州市白云区',
  '广州市越秀区', '广州市荔湾区', '广州市黄埔区', '广州市增城区',
  '广州市从化区', '广州市花都区', '广州市南沙区',
]

async function main() {
  const url = process.env.DATABASE_URL ?? (await Bun.file('.env').text()).match(/DATABASE_URL=(.+)/)?.[1]
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url)

  // name 必须完全由 CJK 统一表意文字组成 ([一-鿿] = U+4E00–U+9FAF)
  // 不允许 ASCII 字母 / 数字 / 连字符 / 其他符号
  // postgres-js 的数组参数在 ARRAY[...] 元素位置展开较麻烦,
  // 这里直接构造内联 ARRAY[...] 字面量(SQL 注入风险为零 — 常量来源)
  const vArray = `ARRAY[${VEHICLE_CANONICAL.map(s => `'${s}'`).join(',')}]`
  const tArray = `ARRAY[${TASK_CANONICAL.map(s => `'${s}'`).join(',')}]`
  const rArray = `ARRAY[${REGION_CANONICAL.map(s => `'${s}'`).join(',')}]`

  const v = await sql.unsafe(`
    WITH polluted AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn
      FROM vehicle_classes
      WHERE name !~ '^[一-鿿]+$'
    ),
    mapped AS (
      SELECT id, (${vArray})[(rn % ${VEHICLE_CANONICAL.length}) + 1] AS new_name
      FROM polluted
    )
    UPDATE vehicle_classes vc SET name = m.new_name
    FROM mapped m WHERE vc.id = m.id
    RETURNING vc.id
  `)
  console.log(`vehicle_classes: ${v.length} 行改写`)

  const t = await sql.unsafe(`
    WITH polluted AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn
      FROM task_classes
      WHERE name !~ '^[一-鿿]+$'
    ),
    mapped AS (
      SELECT id, (${tArray})[(rn % ${TASK_CANONICAL.length}) + 1] AS new_name
      FROM polluted
    )
    UPDATE task_classes tc SET name = m.new_name
    FROM mapped m WHERE tc.id = m.id
    RETURNING tc.id
  `)
  console.log(`task_classes: ${t.length} 行改写`)

  const r = await sql.unsafe(`
    WITH polluted AS (
      SELECT id, version, ROW_NUMBER() OVER (ORDER BY id, version) - 1 AS rn
      FROM regions
      WHERE name IS NOT NULL AND name !~ '^[一-鿿]+$'
    ),
    mapped AS (
      SELECT id, version, (${rArray})[(rn % ${REGION_CANONICAL.length}) + 1] AS new_name
      FROM polluted
    )
    UPDATE regions SET name = m.new_name
    FROM mapped m WHERE regions.id = m.id AND regions.version = m.version
    RETURNING regions.id
  `)
  console.log(`regions: ${r.length} 行改写`)

  // 验证残留
  const v2 = await sql`SELECT COUNT(*)::int AS n FROM vehicle_classes WHERE name !~ '^[一-鿿]+$'`
  const t2 = await sql`SELECT COUNT(*)::int AS n FROM task_classes WHERE name !~ '^[一-鿿]+$'`
  const r2 = await sql`SELECT COUNT(*)::int AS n FROM regions WHERE name IS NOT NULL AND name !~ '^[一-鿿]+$'`
  console.log()
  console.log('验证 — 应全为 0:')
  console.log(`  vehicle_classes 非中文剩余: ${v2[0]!.n}`)
  console.log(`  task_classes 非中文剩余: ${t2[0]!.n}`)
  console.log(`  regions 非中文剩余: ${r2[0]!.n}`)

  await sql.end()
}

main().catch(err => { console.error(err); process.exit(1) })
