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
