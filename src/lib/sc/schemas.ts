import { z } from 'zod'

// 빈 문자열이나 null을 undefined로 정규화 — 프론트가 비어있는 필드를 null/''로 보내는 케이스 허용
const emptyToUndefined = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string())

// slug 정규화 — kebab-case 영문 소문자·숫자·하이픈만 허용 (채널 platformSlug 에서 사용)
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const slugSchema = z.string().min(2).max(60).regex(slugPattern, {
  message: 'slug는 소문자·숫자·하이픈만 허용합니다 (예: my-channel)',
})

// customFields KV 배열 — [{ key: string, value: string }]
export const customFieldsSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(100),
      value: z.string().max(2000),
    })
  )
  .max(50)
  .optional()
export type CustomFieldsInput = z.infer<typeof customFieldsSchema>

// ─── Product ─────────────────────────────────────────────────────────────────
export const productSchema = z.object({
  name: z.string().min(1, '상품명을 입력하세요').max(200),
  oneLinerPitch: emptyToUndefined.pipe(z.string().max(200)).optional(),
  customFields: customFieldsSchema,
  isActive: z.boolean().default(true),
})
export type ProductInput = z.infer<typeof productSchema>

// ─── Persona ────────────────────────────────────────────────────────────────
export const personaSchema = z.object({
  name: z.string().min(1, '페르소나 이름을 입력하세요').max(200),
  jobTitle: emptyToUndefined.pipe(z.string().max(200)).optional(),
  industry: emptyToUndefined.pipe(z.string().max(200)).optional(),
  customFields: customFieldsSchema,
  isActive: z.boolean().default(true),
})
export type PersonaInput = z.infer<typeof personaSchema>

// ─── Brand Profile (Space당 1개) ───────────────────────────────────────────

export const brandProfileSchema = z.object({
  companyName: z.string().min(1, '회사명을 입력하세요').max(200),
  shortDescription: emptyToUndefined.pipe(z.string().max(400)).optional(),
  toneOfVoice: z.array(z.string().min(1).max(200)).max(10).optional(),
  customFields: customFieldsSchema,
})
export type BrandProfileInput = z.infer<typeof brandProfileSchema>

// ─── Ideation ───────────────────────────────────────────────────────────────

export const runIdeationSchema = z.object({
  // personaId 는 새 스키마에서 required (Ideation.personaId NOT NULL)
  personaId: z.string().cuid(),
  // 상품은 다중 선택 (M:N) — 빈 배열 허용
  productIds: z.array(z.string().cuid()).max(10).optional(),
  targetKeywords: z.array(z.string().min(1).max(200)).max(10).optional(),
  userPromptInput: emptyToUndefined.pipe(z.string().max(2000)).optional(),
  count: z.number().int().min(3).max(10).optional(),
})
export type RunIdeationInput = z.infer<typeof runIdeationSchema>

export const userIdeationSchema = z.object({
  personaId: z.string().cuid(),
  productIds: z.array(z.string().cuid()).max(10).optional(),
  targetKeywords: z.array(z.string().min(1).max(200)).max(10).optional(),
  userPromptInput: emptyToUndefined.pipe(z.string().max(2000)).optional(),
  ideas: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        hook: z.string().min(1).max(300),
        angle: z.string().min(1).max(400),
        keyPoints: z.array(z.string().min(1).max(300)).min(1).max(8),
        targetChannel: z.enum(['blog', 'social', 'cardnews']),
        reasoning: z.string().min(1).max(1000),
      })
    )
    .min(1)
    .max(10),
})
export type UserIdeationInput = z.infer<typeof userIdeationSchema>

// ─── Template ───────────────────────────────────────────────────────────────
// 섹션 구조 검증은 template-engine.ts 의 sectionsSchemaForKind 에 위임.
// slug 는 MVP-1 에서 제거됨 (Template 모델에 존재하지 않음).

export const templateInputSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['BLOG', 'SOCIAL', 'CARDNEWS']),
  // sections 는 서버에서 sectionsSchemaForKind(kind) 로 별도 검증.
  sections: z.unknown(),
  isActive: z.boolean().optional(),
})
export type TemplateInput = z.infer<typeof templateInputSchema>

// ─── SalesContentChannel ────────────────────────────────────────────────────

export const salesContentChannelInputSchema = z.object({
  name: z.string().min(1).max(120),
  platformSlug: slugSchema,
  platform: z.enum([
    'BLOG_NAVER',
    'BLOG_TISTORY',
    'BLOG_WORDPRESS',
    'THREADS',
    'X',
    'LINKEDIN',
    'FACEBOOK',
    'INSTAGRAM',
    'YOUTUBE_SHORTS',
    'OTHER',
  ]),
  kind: z.enum(['BLOG', 'SOCIAL']),
  publisherMode: z.enum(['API', 'BROWSER', 'MANUAL']).optional(),
  collectorMode: z.enum(['API', 'BROWSER', 'MANUAL', 'NONE']).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})
export type SalesContentChannelInput = z.infer<typeof salesContentChannelInputSchema>

// ─── Content ────────────────────────────────────────────────────────────────

export const contentCreateSchema = z.object({
  title: z.string().min(1).max(300),
  // TODO 허용 — 아이데이션에서 "콘텐츠로 보내기" 시 status=TODO 로 생성
  status: z.enum(['TODO', 'DRAFT']).optional(),
  ideationId: z.string().cuid().optional().nullable(),
  ideaIndex: z.number().int().min(0).max(19).optional().nullable(),
  channelId: z.string().cuid().optional().nullable(),
  // SEO 메타
  urlSlug: emptyToUndefined.pipe(z.string().max(200)).optional(),
  targetKeyword: emptyToUndefined.pipe(z.string().max(200)).optional(),
  relatedKeywords: z.array(z.string().min(1).max(200)).max(20).optional(),
})
export type ContentCreateInput = z.infer<typeof contentCreateSchema>

export const contentUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  body: z.string().optional().nullable(),
  doc: z.unknown().optional(),
  channelId: z.string().cuid().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  urlSlug: emptyToUndefined.pipe(z.string().max(200)).optional(),
  targetKeyword: emptyToUndefined.pipe(z.string().max(200)).optional(),
  relatedKeywords: z.array(z.string().min(1).max(200)).max(20).optional(),
})
export type ContentUpdateInput = z.infer<typeof contentUpdateSchema>

export const contentTransitionSchema = z.object({
  to: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ANALYZED']),
})

export const contentGenerateSectionSchema = z.object({
  sectionKey: z.string().min(1).max(40),
  sectionLabel: z.string().min(1).max(80),
  sectionKind: z.enum(['text', 'imageSlot', 'cta']),
  sectionGuidance: emptyToUndefined.pipe(z.string().max(1000)).optional(),
  constraints: z
    .object({
      maxLength: z.number().int().positive().optional(),
      required: z.boolean().optional(),
    })
    .optional(),
  additionalInstruction: emptyToUndefined.pipe(z.string().max(1000)).optional(),
})

// ─── Deployment ─────────────────────────────────────────────────────────────

export const deploymentCreateSchema = z.object({
  contentId: z.string().cuid(),
  channelId: z.string().cuid(),
  targetUrl: z.string().url().max(2000),
  scheduledAt: z.string().datetime().optional().nullable(),
  utmCampaign: emptyToUndefined.pipe(z.string().max(80)).optional(),
  utmContent: emptyToUndefined.pipe(z.string().max(80)).optional(),
  utmTerm: emptyToUndefined.pipe(z.string().max(80)).optional(),
  utmSource: emptyToUndefined.pipe(z.string().max(80)).optional(),
  utmMedium: emptyToUndefined.pipe(z.string().max(80)).optional(),
})
export type DeploymentCreateInput = z.infer<typeof deploymentCreateSchema>

export const deploymentUpdateSchema = deploymentCreateSchema.partial().extend({
  status: z.enum(['SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELED']).optional(),
  platformUrl: emptyToUndefined.pipe(z.string().url().max(2000)).optional(),
})

// ─── AI 이미지 생성 공통 스키마 (assets POST ai 모드 + /api/sc/ai/generate-image 공유) ──
export const aiImageBaseSchema = z.object({
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(2000).optional(),
  aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).optional(),
})
export type AiImageBaseInput = z.infer<typeof aiImageBaseSchema>

// ─── ImprovementRule ────────────────────────────────────────────────────────

export const improvementRuleInputSchema = z.object({
  scope: z.enum(['WORKSPACE', 'PRODUCT', 'PERSONA', 'CHANNEL', 'COMBINATION']),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  weight: z.number().int().min(0).max(100).optional(),
  targetProductId: z.string().cuid().optional().nullable(),
  targetPersonaId: z.string().cuid().optional().nullable(),
  targetChannelId: z.string().cuid().optional().nullable(),
  status: z.enum(['PROPOSED', 'ACTIVE', 'ARCHIVED']).optional(),
})
export type ImprovementRuleInput = z.infer<typeof improvementRuleInputSchema>
