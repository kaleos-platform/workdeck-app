import { z } from 'zod'
import { aiImageBaseSchema } from '../schemas'

// ─── Fix 5: aiImageBaseSchema (공유 AI 이미지 스키마) ──────────────────────

describe('aiImageBaseSchema', () => {
  it('유효한 최소 입력 (prompt 만)', () => {
    const result = aiImageBaseSchema.safeParse({ prompt: '고양이 사진' })
    expect(result.success).toBe(true)
  })

  it('유효한 전체 입력', () => {
    const result = aiImageBaseSchema.safeParse({
      prompt: '귀여운 강아지',
      negativePrompt: '흐릿한 배경',
      aspectRatio: '16:9',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.aspectRatio).toBe('16:9')
    }
  })

  it('prompt 빈 문자열 → 실패', () => {
    const result = aiImageBaseSchema.safeParse({ prompt: '' })
    expect(result.success).toBe(false)
  })

  it('prompt 없음 → 실패', () => {
    const result = aiImageBaseSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('prompt 4000자 초과 → 실패', () => {
    const result = aiImageBaseSchema.safeParse({ prompt: 'a'.repeat(4001) })
    expect(result.success).toBe(false)
  })

  it('negativePrompt 2000자 초과 → 실패', () => {
    const result = aiImageBaseSchema.safeParse({
      prompt: '정상 프롬프트',
      negativePrompt: 'x'.repeat(2001),
    })
    expect(result.success).toBe(false)
  })

  it('잘못된 aspectRatio → 실패', () => {
    const result = aiImageBaseSchema.safeParse({
      prompt: '정상 프롬프트',
      aspectRatio: '2:3',
    })
    expect(result.success).toBe(false)
  })

  it('assets 확장 스키마 (mode=ai, slotKey, alt) — 유효', () => {
    const assetsSchema = aiImageBaseSchema.extend({
      mode: z.literal('ai'),
      slotKey: z.string().optional(),
      alt: z.string().optional(),
    })
    const result = assetsSchema.safeParse({
      mode: 'ai',
      prompt: '배너 이미지',
      slotKey: 'hero',
      alt: '히어로 이미지',
    })
    expect(result.success).toBe(true)
  })

  it('assets 확장 스키마 — mode 누락 시 실패', () => {
    const assetsSchema = aiImageBaseSchema.extend({
      mode: z.literal('ai'),
      slotKey: z.string().optional(),
      alt: z.string().optional(),
    })
    const result = assetsSchema.safeParse({ prompt: '배너 이미지' })
    expect(result.success).toBe(false)
  })
})

// ─── Fix 6: credentials DELETE kind 검증 ──────────────────────────────────

describe('credentials kind enum', () => {
  const kindSchema = z.enum(['COOKIE', 'OAUTH', 'API_KEY'])

  it('유효한 kind 값들', () => {
    expect(kindSchema.safeParse('COOKIE').success).toBe(true)
    expect(kindSchema.safeParse('OAUTH').success).toBe(true)
    expect(kindSchema.safeParse('API_KEY').success).toBe(true)
  })

  it('잘못된 kind 값 → 실패', () => {
    expect(kindSchema.safeParse('INVALID').success).toBe(false)
    expect(kindSchema.safeParse('cookie').success).toBe(false)
    expect(kindSchema.safeParse('').success).toBe(false)
    expect(kindSchema.safeParse(null).success).toBe(false)
  })
})
