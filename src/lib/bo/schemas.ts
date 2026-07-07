import { z } from 'zod'

// 빈 문자열이나 null을 undefined로 정규화 — 프론트가 비어있는 필드를 null/''로 보내는 케이스 허용
const emptyToUndefined = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string())

// ─── BoProduct ────────────────────────────────────────────────────────────────

export const boProductSchema = z.object({
  name: z.string().min(1, '제품명을 입력하세요').max(200),
  category: z.enum(['B2B', 'B2C', '기타']).optional(),
  oneLinerPitch: emptyToUndefined.pipe(z.string().max(200)).optional(),
  homepageUrl: emptyToUndefined.pipe(z.string().url('올바른 URL 형식이어야 합니다')).optional(),
  targetCustomer: emptyToUndefined.pipe(z.string().max(500)).optional(),
  ctaUrl: emptyToUndefined.pipe(z.string().url('올바른 URL 형식이어야 합니다')).optional(),
  features: z.array(z.string().min(1).max(300)).max(20).optional(),
  customFields: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        value: z.string().max(2000),
      })
    )
    .max(50)
    .optional(),
  isActive: z.boolean().default(true),
})

export type BoProductInput = z.infer<typeof boProductSchema>
