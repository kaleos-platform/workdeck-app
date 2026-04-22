import { z } from 'zod'

// ─── 공용 id 검증 ──────────────────────────────────────────────────────────────
//
// 레거시 백필 데이터는 UUID(36자, hyphen 포함)이고, 신규 데이터는 Prisma cuid
// (25자 이하). Zod v4의 .cuid()는 CUID1 전용이라 UUID를 거부하므로 두 포맷을
// 모두 허용하는 완화 검증을 사용한다. 실제 소속 검증은 서버에서 findFirst로
// 수행하므로 여기서는 "비어있지 않은 적당히 짧은 문자열" 정도만 보장한다.
const idLike = z.string().min(8).max(64)

// 빈 문자열이나 null을 undefined로 정규화하는 전처리기 — 프론트가 비어있는 필드를
// null 또는 ''로 보내는 케이스를 모두 허용한다
const emptyToUndefined = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string())

export const brandSchema = z.object({
  name: z.string().min(1, '브랜드명을 입력하세요').max(100),
  logoUrl: emptyToUndefined.pipe(z.string().url()).optional(),
  memo: emptyToUndefined.pipe(z.string().max(500)).optional(),
})
export type BrandInput = z.infer<typeof brandSchema>

// ─── 상품 옵션 ──────────────────────────────────────────────────────────────

export const productOptionSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(100))
    .optional(),
  costPrice: z
    .preprocess(
      (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
      z.number().nonnegative()
    )
    .optional(),
  retailPrice: z
    .preprocess(
      (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
      z.number().nonnegative()
    )
    .optional(),
  sizeLabel: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(50))
    .optional(),
  setSizeLabel: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(50))
    .optional(),
  attributeValues: z.record(z.string(), z.string()).optional(), // 예: {"사이즈":"S","색상":"파랑"}
})
export type ProductOptionInput = z.infer<typeof productOptionSchema>

// ─── 상품 ──────────────────────────────────────────────────────────────────

// 옵션 속성 항목 스키마 (예: {name: "사이즈", values: ["S","M","L"]})
const optionAttributeSchema = z.object({
  name: z.string().min(1).max(50),
  values: z.array(z.string().min(1).max(50)).min(1).max(50),
})

export const productSchema = z.object({
  name: z.string().min(1).max(200),
  nameEn: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(200))
    .optional(),
  code: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(100))
    .optional(),
  brandId: z.preprocess((v) => (v === null || v === '' ? undefined : v), idLike).optional(),
  // 카테고리 필수 — POST에선 required, PATCH에선 partial()로 optional이 된다.
  // null/'' 전달 시 undefined로 정규화해서 id 검증을 건너뛴다 (partial에서만 OK).
  groupId: z.preprocess((v) => (v === null || v === '' ? undefined : v), idLike),
  manufacturer: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(200))
    .optional(),
  manufactureCountry: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(100))
    .optional(),
  // date-only(YYYY-MM-DD) / ISO datetime / null / '' 모두 허용 → 최종적으로 string | undefined
  manufactureDate: z
    .preprocess(
      (v) => (v === null || v === '' ? undefined : v),
      z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), '유효한 날짜가 아닙니다')
    )
    .optional(),
  features: z.array(z.string()).optional(),
  // 프론트가 문자열 배열로 전송 — 인증번호 한 줄씩
  certifications: z.array(z.string()).optional(),
  msrp: z
    .preprocess(
      (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
      z.number().nonnegative()
    )
    .optional(),
  description: z
    .preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(2000))
    .optional(),
  optionAttributes: z.array(optionAttributeSchema).optional(),
  options: z.array(productOptionSchema).optional(),
})
export type ProductInput = z.infer<typeof productSchema>

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

// null / '' 를 undefined 로 정규화 — 프론트가 null로 보내도 optional 필드가 안전하게 처리됨
const toUndef = (v: unknown) => (v === null || v === '' ? undefined : v)

export const channelSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z
    .enum(['ONLINE_MARKETPLACE', 'ONLINE_MALL', 'OFFLINE', 'INTERNAL_TRANSFER', 'OTHER'])
    .default('ONLINE_MARKETPLACE'),
  // groupId: null|'' → undefined → id 검증 skip (UUID/CUID 모두 허용)
  groupId: z.preprocess(toUndef, idLike).optional(),
  isActive: z.boolean().default(true),
  // adminUrl: null|'' → undefined → url 검증 skip
  adminUrl: z.preprocess(toUndef, z.string().url()).optional(),
  freeShipping: z.boolean().default(false),
  usesMarketingBudget: z.boolean().default(false),
  // shippingFee: null|'' → undefined → number 검증 skip
  shippingFee: z
    .preprocess(
      (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
      z.number().nonnegative()
    )
    .optional(),
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
  // 클라이언트가 null/공백 전송 시에도 유효성 검증을 통과하지 않도록 preprocess로 정규화
  categoryName: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1, '카테고리를 선택하세요').max(100)
  ),
  // 문자열로 전송되더라도 number 로 강제 변환
  ratePercent: z.preprocess(
    (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(100)
  ),
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
