// 채널 생성·수정·프로필 검증용 Zod 스키마.

import { z } from 'zod'

// ─── 포맷 프로필 스키마 ───────────────────────────────────────────────────────

export const formatProfileSchema = z.object({
  toneGuide: z.string().min(1, '말투 지침을 입력하세요'),
  structureGuide: z.string().min(1, '구조 지침을 입력하세요'),
  lengthRange: z.object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
  headingStyle: z.string(),
  forbiddenExpressions: z.array(z.string()),
  ctaStyle: z.string(),
  passthrough: z.boolean().optional(),
})

// ─── 채널 생성 스키마 ─────────────────────────────────────────────────────────

export const createChannelBodySchema = z.object({
  platform: z.enum(['NAVER_BLOG', 'TISTORY', 'OWN_HOMEPAGE']),
  name: z.string().min(1, '채널 이름을 입력하세요').max(100),
  /** 미제공 시 플랫폼 기본 프로필이 사용됨 */
  formatProfile: formatProfileSchema.optional(),
  publisherMode: z.enum(['MANUAL', 'BROWSER']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

// ─── 채널 수정 스키마 (PATCH) ────────────────────────────────────────────────

export const updateChannelBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  formatProfile: formatProfileSchema.optional(),
  isActive: z.boolean().optional(),
  publisherMode: z.enum(['MANUAL', 'BROWSER']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export type CreateChannelBody = z.infer<typeof createChannelBodySchema>
export type UpdateChannelBody = z.infer<typeof updateChannelBodySchema>
export type FormatProfileInput = z.infer<typeof formatProfileSchema>
