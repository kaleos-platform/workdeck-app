import { z } from 'zod'

// ─── AI 온보딩 초안 스키마 ───────────────────────────────────────────────────
// generate 라우트가 LLM JSON 응답을 검증할 때 사용. 필드 상한은 기존
// src/lib/sc/schemas.ts (brandProfileSchema/productSchema/personaSchema)와 맞춘다.

const trimmed = (max: number) => z.string().trim().min(1).max(max)

export const draftBrandProfileSchema = z.object({
  companyName: trimmed(200),
  shortDescription: z.string().trim().max(400).optional(),
  toneOfVoice: z.array(trimmed(200)).max(3).optional(),
})

export const draftProductSchema = z.object({
  name: trimmed(200),
  oneLinerPitch: z.string().trim().max(200).optional(),
})

export const draftPersonaSchema = z.object({
  name: trimmed(200),
  jobTitle: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(200).optional(),
})

export const onboardingDraftSchema = z.object({
  brandProfile: draftBrandProfileSchema,
  products: z.array(draftProductSchema).max(5).default([]),
  personas: z.array(draftPersonaSchema).max(3).default([]),
})

export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>

// ─── 요청 스키마 ─────────────────────────────────────────────────────────────

export const addUrlResourceSchema = z.object({
  kind: z.literal('URL'),
  url: z.string().trim().url().max(2000),
})

export const onboardingStatusPatchSchema = z
  .object({
    dismissed: z.literal(true).optional(),
    completed: z.literal(true).optional(),
  })
  .refine((v) => v.dismissed || v.completed, { message: 'dismissed 또는 completed가 필요합니다' })
