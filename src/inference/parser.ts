import { InferenceError } from './types'

// LLM 输出的 JSON 偶尔会被 ```json ... ``` 包裹或前后带解释文本。
// 提取首个 {...} 或 [...] 整体子串后 JSON.parse;失败抛 InferenceError('PARSE')
export function extractJson<T>(text: string): T {
  const trimmed = text.trim()
  // 优先尝试整体解析
  try { return JSON.parse(trimmed) as T } catch { /* fall through */ }

  // 找第一个 { 或 [ 开始,匹配最近的 } 或 ]
  const candidates = ['{', '['].map(c => trimmed.indexOf(c)).filter(i => i >= 0)
  if (candidates.length === 0) throw new InferenceError('PARSE', 'no JSON object/array found in response')
  const start = Math.min(...candidates)
  const open = trimmed[start]!
  const close = open === '{' ? '}' : ']'

  let depth = 0, inStr = false, esc = false
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i]!
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        const slice = trimmed.slice(start, i + 1)
        try { return JSON.parse(slice) as T }
        catch (e) { throw new InferenceError('PARSE', `JSON.parse failed: ${(e as Error).message}`) }
      }
    }
  }
  throw new InferenceError('PARSE', `unterminated ${open}…${close}`)
}
