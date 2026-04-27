import { z } from 'zod'

// 빈 문자열이나 null을 undefined로 정규화 — 프론트가 비어있는 필드를 null/''로 보내는 케이스 허용
const emptyToUndefined = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string())

// slug 정규화 — kebab-case 영문 소문자·숫자·하이픈만 허용
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const slugSchema = z.string().min(2).max(60).regex(slugPattern, {
  message: 'slug는 소문자·숫자·하이픈만 허용합니다 (예: my-product)',
})

// 문자열 배열 — 빈 문자열 제거, 각 항목 길이 제한
const stringListSchema = z.array(z.string().min(1).max(200)).max(50)

// 증빙 자료 (case_study / testimonial / metric / award)
const proofPointSchema = z.object({
  type: z.enum(['case_study', 'testimonial', 'metric', 'award', 'other']),
  title: z.string().min(1).max(200),
  detail: emptyToUndefined.pipe(z.string().max(2000)).optional(),
  url: emptyToUndefined.pipe(z.string().url()).optional(),
})

// ─── B2B Product ────────────────────────────────────────────────────────────
export const b2bProductSchema = z.object({
  name: z.string().min(1, '상품명을 입력하세요').max(200),
  slug: slugSchema,
  oneLinerPitch: emptyToUndefined.pipe(z.string().max(200)).optional(),
  valueProposition: emptyToUndefined.pipe(z.string().max(4000)).optional(),
  targetCustomers: emptyToUndefined.pipe(z.string().max(2000)).optional(),
  keyFeatures: stringListSchema.optional(),
  differentiators: stringListSchema.optional(),
  painPointsAddressed: stringListSchema.optional(),
  proofPoints: z.array(proofPointSchema).max(20).optional(),
  pricingModel: emptyToUndefined.pipe(z.string().max(2000)).optional(),
  priceMin: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.number().nonnegative())
    .optional(),
  priceMax: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.number().nonnegative())
    .optional(),
  ctaTargetUrl: emptyToUndefined.pipe(z.string().url()).optional(),
  isActive: z.boolean().default(true),
})
export type B2BProductInput = z.infer<typeof b2bProductSchema>

// ─── Persona ────────────────────────────────────────────────────────────────
export const personaSchema = z.object({
  name: z.string().min(1, '페르소나 이름을 입력하세요').max(200),
  slug: slugSchema,
  jobTitle: emptyToUndefined.pipe(z.string().max(200)).optional(),
  industry: emptyToUndefined.pipe(z.string().max(200)).optional(),
  companySize: emptyToUndefined.pipe(z.string().max(200)).optional(),
  seniority: emptyToUndefined.pipe(z.string().max(100)).optional(),
  decisionRole: emptyToUndefined.pipe(z.string().max(100)).optional(),
  goals: stringListSchema.optional(),
  painPoints: stringListSchema.optional(),
  objections: stringListSchema.optional(),
  preferredChannels: stringListSchema.optional(),
  toneHints: emptyToUndefined.pipe(z.string().max(1000)).optional(),
  isActive: z.boolean().default(true),
})
export type PersonaInput = z.infer<typeof personaSchema>

// ─── Brand Profile (Space당 1개) ───────────────────────────────────────────
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '6자리 HEX 색상값을 입력하세요')

export const brandProfileSchema = z.object({
  companyName: z.string().min(1, '회사명을 입력하세요').max(200),
  shortDescription: emptyToUndefined.pipe(z.string().max(400)).optional(),
  missionStatement: emptyToUndefined.pipe(z.string().max(1000)).optional(),
  toneOfVoice: stringListSchema.optional(),
  forbiddenPhrases: stringListSchema.optional(),
  preferredPhrases: stringListSchema.optional(),
  styleGuideUrl: emptyToUndefined.pipe(z.string().url()).optional(),
  primaryColor: emptyToUndefined.pipe(hexColorSchema).optional(),
  secondaryColor: emptyToUndefined.pipe(hexColorSchema).optional(),
  logoUrl: emptyToUndefined.pipe(z.string().url()).optional(),
})
export type BrandProfileInput = z.infer<typeof brandProfileSchema>

// ─── Ideation ───────────────────────────────────────────────────────────────

export const runIdeationSchema = z.object({
  productId: z.string().cuid().optional().nullable(),
  personaId: z.string().cuid().optional().nullable(),
  userPromptInput: emptyToUndefined.pipe(z.string().max(2000)).optional(),
  count: z.number().int().min(3).max(10).optional(),
})
export type RunIdeationInput = z.infer<typeof runIdeationSchema>

export const userIdeationSchema = z.object({
  productId: z.string().cuid().optional().nullable(),
  personaId: z.string().cuid().optional().nullable(),
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

export const templateInputSchema = z.object({
  name: z.string().min(1).max(120),
  slug: slugSchema,
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
  templateId: z.string().cuid().optional().nullable(),
  ideationId: z.string().cuid().optional().nullable(),
  ideaIndex: z.number().int().min(0).max(19).optional().nullable(),
  productId: z.string().cuid().optional().nullable(),
  personaId: z.string().cuid().optional().nullable(),
  channelId: z.string().cuid().optional().nullable(),
})
export type ContentCreateInput = z.infer<typeof contentCreateSchema>

export const contentUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  doc: z.unknown().optional(),
  channelId: z.string().cuid().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
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
