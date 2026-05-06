import { describe, expect, test } from 'bun:test'
import { extractJson } from '@/inference/parser'

describe('extractJson', () => {
  test('plain JSON object', () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 })
  })
  test('JSON wrapped in markdown fence', () => {
    expect(extractJson<{ b: string }>('```json\n{"b": "x"}\n```')).toEqual({ b: 'x' })
  })
  test('JSON with explanation prefix', () => {
    expect(extractJson<{ c: number }>('Here is the result: {"c": 42}')).toEqual({ c: 42 })
  })
  test('throws on no JSON', () => {
    expect(() => extractJson('no json here')).toThrow(/no JSON/)
  })
  test('handles strings with curly braces', () => {
    expect(extractJson<{ s: string }>('{"s": "{not real}"}')).toEqual({ s: '{not real}' })
  })
})
