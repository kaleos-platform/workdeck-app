import { z } from 'zod'

// ─── 브랜드 ──────────────────────────────────────────────────────────────────

// 빈 문자열이나 null을 undefined로 정규화하는 전처리기 — 프론트가 비어있는 필드를
// null 또는 ''로 보내는 케이스를 모두 허용한다
const emptyToUndefined = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string())

export const brandSchema = z.object({
  name: z.string().min(1, '브랜드명을 입력하세요').max(100),
  logoUrl: emptyToUndefined.pipe(z.string().url()).optional(),
  memo: emptyToUndefined.pipe(z.string().max(500)).optional(),
})
export type BrandInput = z.infer<typeof brandSchema>

// ─── 상품 ──────────────────────────────────────────────────────────────────

export const productSchema = z.object({
  name: z.string().min(1).max(200),
  nameEn: z.string().max(200).optional(),
  code: z.string().max(100).optional(),
  brandId: z.string().cuid().optional(),
  groupId: z.string().cuid().optional(),
  manufacturer: z.string().max(200).optional(),
  manufactureCountry: z.string().max(100).optional(),
  manufactureDate: z.string().datetime().optional(),
  features: z.array(z.string()).optional(),
  certifications: z
    .array(
      z.object({
        type: z.string(),
        code: z.string().optional(),
        issuedAt: z.string().optional(),
      })
    )
    .optional(),
  msrp: z.number().nonnegative().optional(),
  description: z.string().max(2000).optional(),
})
export type ProductInput = z.infer<typeof productSchema>

// ─── 상품 옵션 ──────────────────────────────────────────────────────────────

export const productOptionSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().max(100).optional(),
  costPrice: z.number().nonnegative().optional(),
  retailPrice: z.number().nonnegative().optional(),
  sizeLabel: z.string().max(50).optional(),
  setSizeLabel: z.string().max(50).optional(),
})
export type ProductOptionInput = z.infer<typeof productOptionSchema>

// ─── 생산 차수 ──────────────────────────────────────────────────────────────

export const productionBatchSchema = z.object({
  batchNo: z.string().min(1).max(50),
  producedAt: z.string().datetime(),
  unitCost: z.number().nonnegative(),
  quantity: z.number().int().positive().optional(),
  memo: z.string().max(500).optional(),
})
export type ProductionBatchInput = z.infer<typeof productionBatchSchema>

// ─── 채널 ──────────────────────────────────────────────────────────────────

export const channelSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z
    .enum(['ONLINE_MARKETPLACE', 'ONLINE_MALL', 'OFFLINE', 'INTERNAL_TRANSFER', 'OTHER'])
    .default('ONLINE_MARKETPLACE'),
  groupId: z.string().cuid().optional(),
  isActive: z.boolean().default(true),
  adminUrl: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  freeShipping: z.boolean().default(false),
  usesMarketingBudget: z.boolean().default(false),
  shippingFee: z.number().nonnegative().optional(),
  vatIncludedInFee: z.boolean().default(true),
  requireOrderNumber: z.boolean().default(true),
  requirePayment: z.boolean().default(true),
  requireProducts: z.boolean().default(true),
})
export type ChannelInput = z.infer<typeof channelSchema>

// ─── 채널 그룹 ──────────────────────────────────────────────────────────────

export const channelGroupSchema = z.object({
  name: z.string().min(1).max(100),
})
export type ChannelGroupInput = z.infer<typeof channelGroupSchema>

// ─── 채널 수수료율 ──────────────────────────────────────────────────────────

export const channelFeeRateSchema = z.object({
  categoryName: z.string().min(1).max(100),
  ratePercent: z.number().min(0).max(100),
  vatIncluded: z.boolean().default(true),
})
export type ChannelFeeRateInput = z.infer<typeof channelFeeRateSchema>

// ─── 가격 설정 ──────────────────────────────────────────────────────────────

export const pricingSettingsSchema = z.object({
  defaultOperatingCostPct: z.number().min(0).max(100),
  defaultAdCostPct: z.number().min(0).max(100),
  defaultPackagingCost: z.number().nonnegative(),
})
export type PricingSettingsInput = z.infer<typeof pricingSettingsSchema>
