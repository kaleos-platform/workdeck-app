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

// 옵션 속성 값 스키마 — {value, code} 구조.
// 레거시 호환: 문자열로 들어오면 code 미지정(빈 문자열)으로 정규화.
const optionAttributeValueSchema = z.preprocess(
  (v) => {
    if (typeof v === 'string') return { value: v, code: '' }
    return v
  },
  z.object({
    value: z.string().min(1).max(50),
    code: z.string().max(10).optional().default(''),
  })
)

// 옵션 속성 항목 스키마 (예: {name:"사이즈", values:[{value:"S",code:"S"}, ...]})
const optionAttributeSchema = z.object({
  name: z.string().min(1).max(50),
  values: z.array(optionAttributeValueSchema).min(1).max(50),
})

export const productSchema = z.object({
  // 공식 상품명 — 판매채널 노출명 (필수)
  name: z.string().min(1, '공식 상품명을 입력해주세요').max(200),
  // 관리 상품명 — 내부 식별용 (선택, 비어있으면 표시 시 name으로 fallback)
  // PATCH에서 null/'' 는 명시적 clear 신호로 null 저장, undefined 는 필드 skip
  internalName: z
    .preprocess((v) => {
      if (v === undefined) return undefined
      if (v === null) return null
      if (typeof v === 'string' && v.trim() === '') return null
      return v
    }, z.string().max(200).nullable())
    .optional(),
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

// ─── 채널 ──────────────────────────────────────────────────────────────────

// null / '' 를 undefined 로 정규화 — 프론트가 null로 보내도 optional 필드가 안전하게 처리됨
const toUndef = (v: unknown) => (v === null || v === '' ? undefined : v)

// null|''|undefined → undefined 변환 후 number 강제 변환 (optional 필드용)
const toOptionalNumber = (v: unknown) =>
  v === null || v === '' || v === undefined ? undefined : Number(v)

export const channelSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z
    .enum(['ONLINE_MARKETPLACE', 'ONLINE_MALL', 'OFFLINE', 'INTERNAL_TRANSFER', 'OTHER'])
    .default('ONLINE_MARKETPLACE'),
  channelType: z
    .enum(['OPEN_MARKET', 'DEPT_STORE', 'SELF_MALL', 'SOCIAL', 'WHOLESALE', 'OTHER'])
    .default('OTHER'),
  // groupId: null|'' → undefined → id 검증 skip (UUID/CUID 모두 허용)
  groupId: z.preprocess(toUndef, idLike).optional(),
  isActive: z.boolean().default(true),
  // adminUrl: null|'' → undefined → url 검증 skip
  adminUrl: z.preprocess(toUndef, z.string().url()).optional(),
  freeShipping: z.boolean().default(false),
  // freeShippingThreshold: 무료배송 최소 주문금액 (원)
  freeShippingThreshold: z.preprocess(toOptionalNumber, z.number().nonnegative()).optional(),
  // defaultFeePct: 채널 기본 수수료율 0~1
  defaultFeePct: z.preprocess(toOptionalNumber, z.number().min(0).max(1)).optional(),
  usesMarketingBudget: z.boolean().default(false),
  applyAdCost: z.boolean().default(false),
  // shippingFee: null|'' → undefined → number 검증 skip
  shippingFee: z.preprocess(toOptionalNumber, z.number().nonnegative()).optional(),
  vatIncludedInFee: z.boolean().default(true),
  paymentFeeIncluded: z.boolean().default(true),
  paymentFeePct: z.preprocess(toOptionalNumber, z.number().min(0).max(1)).optional(),
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
  // 기존 필드 — 0~100 % 단위 (레거시 호환 유지)
  defaultOperatingCostPct: z.number().min(0).max(100),
  defaultAdCostPct: z.number().min(0).max(100),
  defaultPackagingCost: z.number().nonnegative(),
  // 신규 필드 — 0~1 비율 단위
  defaultChannelFeePct: z.number().min(0).max(1).default(0),
  defaultShippingCost: z.number().nonnegative().default(0),
  defaultReturnRate: z.number().min(0).max(1).default(0),
  defaultReturnShipping: z.number().nonnegative().default(0),
  autoApplyChannelFee: z.boolean().default(false),
  autoApplyAdCost: z.boolean().default(false),
  autoApplyShipping: z.boolean().default(false),
  // 마진 등급 임계값 — 0~1 비율 단위
  selfMallTargetGood: z.number().min(0).max(1).default(0.35),
  selfMallTargetFair: z.number().min(0).max(1).default(0.25),
  platformTargetGood: z.number().min(0).max(1).default(0.25),
  platformTargetFair: z.number().min(0).max(1).default(0.15),
  minimumAcceptableMargin: z.number().min(0).max(1).default(0.1),
})
export type PricingSettingsInput = z.infer<typeof pricingSettingsSchema>

// ─── 판매채널 상품 (ProductListing) ──────────────────────────────────────────
// 채널별 상품 묶음. 구성 옵션 1~50개, 키워드 최대 30개, 상품명 200자 소프트 상한.

const listingNameSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : v),
  z.string().min(1, '상품명을 입력하세요').max(200)
)

export const productListingItemSchema = z.object({
  optionId: idLike,
  quantity: z.preprocess(
    (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
    z.number().int().min(1, '수량은 1 이상이어야 합니다').max(999)
  ),
  sortOrder: z
    .preprocess(
      (v) => (v === null || v === '' || v === undefined ? 0 : Number(v)),
      z.number().int().min(0)
    )
    .default(0),
})
export type ProductListingItemInput = z.infer<typeof productListingItemSchema>

export const productListingSchema = z
  .object({
    channelId: idLike,
    internalCode: emptyToUndefined.pipe(z.string().trim().max(50)).optional(),
    searchName: listingNameSchema,
    displayName: listingNameSchema,
    keywords: z
      .array(z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(50)))
      .max(30)
      .default([]),
    retailPrice: z
      .preprocess(
        (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
        z.number().min(0).max(99_999_999)
      )
      .optional(),
    channelAllocation: z
      .preprocess(
        (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
        z.number().int().min(0).max(999_999)
      )
      .optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
    memo: emptyToUndefined.pipe(z.string().trim().max(500)).optional(),
    items: z.array(productListingItemSchema).min(1, '구성 옵션을 1개 이상 추가해 주세요').max(50),
  })
  .superRefine((v, ctx) => {
    const ids = new Set<string>()
    for (const it of v.items) {
      if (ids.has(it.optionId)) {
        ctx.addIssue({
          code: 'custom',
          message: '같은 옵션이 중복되었습니다',
          path: ['items'],
        })
      }
      ids.add(it.optionId)
    }
  })
export type ProductListingInput = z.infer<typeof productListingSchema>

// PATCH — 모든 필드 선택. items는 있으면 전체 교체.
export const productListingPatchSchema = z
  .object({
    internalCode: emptyToUndefined.pipe(z.string().trim().max(50)).optional().nullable(),
    searchName: listingNameSchema.optional(),
    displayName: listingNameSchema.optional(),
    keywords: z
      .array(z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(50)))
      .max(30)
      .optional(),
    retailPrice: z
      .preprocess(
        (v) => (v === null || v === '' ? null : v === undefined ? undefined : Number(v)),
        z.union([z.number().min(0).max(99_999_999), z.null()])
      )
      .optional(),
    channelAllocation: z
      .preprocess(
        (v) => (v === null || v === '' ? null : v === undefined ? undefined : Number(v)),
        z.union([z.number().int().min(0).max(999_999), z.null()])
      )
      .optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    memo: emptyToUndefined.pipe(z.string().trim().max(500)).optional().nullable(),
    items: z.array(productListingItemSchema).min(1).max(50).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.items) return
    const ids = new Set<string>()
    for (const it of v.items) {
      if (ids.has(it.optionId)) {
        ctx.addIssue({ code: 'custom', message: '같은 옵션이 중복되었습니다', path: ['items'] })
      }
      ids.add(it.optionId)
    }
  })
export type ProductListingPatchInput = z.infer<typeof productListingPatchSchema>

// 그룹(상품 × 채널) 메타 — 키워드 공통 저장
export const productChannelGroupMetaSchema = z.object({
  keywords: z
    .array(z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(50)))
    .max(30)
    .default([]),
})
export type ProductChannelGroupMetaInput = z.infer<typeof productChannelGroupMetaSchema>

// ─── 생산 발주 (ProductionRun) ───────────────────────────────────────────────

export const productionRunCostSchema = z.object({
  itemName: z.string().trim().min(1).max(100),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v?.length ? v : undefined)),
  spec: z.coerce.number().positive().max(99_999_999).optional(),
  quantity: z.coerce.number().positive().max(99_999_999).default(1),
  unitPrice: z.coerce.number().min(0).max(99_999_999),
  note: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v?.length ? v : undefined)),
  sortOrder: z.number().int().min(0).optional(),
  // 비용 분류 — 기본값 OTHER
  category: z.enum(['MATERIAL', 'LABOR', 'PACKAGING', 'LOGISTICS', 'OTHER']).default('OTHER'),
})
export type ProductionRunCostInput = z.infer<typeof productionRunCostSchema>

export const productionRunItemSchema = z.object({
  optionId: z.string().min(1),
  quantity: z.number().int().positive().max(9_999_999),
})
export type ProductionRunItemInput = z.infer<typeof productionRunItemSchema>

export const productionRunSchema = z.object({
  runNo: z.string().trim().min(1).max(100),
  orderedAt: z.string().min(1), // YYYY-MM-DD
  costMode: z.enum(['TOTAL', 'BREAKDOWN']).default('TOTAL'),
  totalCost: z.coerce.number().min(0).max(99_999_999_999).optional(),
  memo: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v?.length ? v : undefined)),
  // 생산 상태 — default 없음 (PATCH 시 기존값 보존을 위해)
  status: z.enum(['PLANNED', 'ORDERED', 'PRODUCING', 'COMPLETED']).optional(),
  // 대표 브랜드 — null = 명시적 미지정, undefined = 변경 없음(PATCH)
  brandId: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).nullable()).optional(),
  // 납기일 / 완료일 — YYYY-MM-DD 문자열 또는 null
  dueAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable()).optional(),
  completedAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable()).optional(),
  items: z
    .array(productionRunItemSchema)
    .min(1)
    .max(200)
    .superRefine((items, ctx) => {
      const ids = new Set<string>()
      for (const it of items) {
        if (ids.has(it.optionId)) ctx.addIssue({ code: 'custom', message: '같은 옵션 중복' })
        ids.add(it.optionId)
      }
    }),
  costs: z.array(productionRunCostSchema).max(50).default([]),
})
export type ProductionRunInput = z.infer<typeof productionRunSchema>

// PATCH 전용 스키마 — .partial() 후 defaults 없는 필드로 덮어씌워 묵시적 덮어쓰기 방지
export const productionRunPatchSchema = productionRunSchema.partial().extend({
  // POST에서 default('TOTAL')이 있어 partial()만으로는 undefined가 아닌 TOTAL이 됨 — 명시 제거
  costMode: z.enum(['TOTAL', 'BREAKDOWN']).optional(),
  // costs.category에도 default('OTHER') 존재하므로 costs 배열 전체를 재정의
  costs: z
    .array(
      z.object({
        itemName: z.string().trim().min(1).max(100),
        description: z
          .string()
          .trim()
          .max(500)
          .optional()
          .transform((v) => (v?.length ? v : undefined)),
        spec: z.coerce.number().positive().max(99_999_999).optional(),
        quantity: z.coerce.number().positive().max(99_999_999).default(1),
        unitPrice: z.coerce.number().min(0).max(99_999_999),
        note: z
          .string()
          .trim()
          .max(200)
          .optional()
          .transform((v) => (v?.length ? v : undefined)),
        sortOrder: z.number().int().min(0).optional(),
        category: z.enum(['MATERIAL', 'LABOR', 'PACKAGING', 'LOGISTICS', 'OTHER']).optional(),
      })
    )
    .max(50)
    .optional(),
})
export type ProductionRunPatchInput = z.infer<typeof productionRunPatchSchema>

// ─── 가격 시뮬레이션 시나리오 ──────────────────────────────────────────────────

export const pricingScenarioItemSchema = z
  .object({
    // optionId: null|undefined 허용 — 수동 입력 행은 optionId 없이 manualName으로 입력
    optionId: z.string().min(1).optional().nullable(),
    manualName: z.string().trim().max(200).optional().nullable(),
    manualBrandName: z.string().trim().max(100).optional().nullable(),
    unitsPerSet: z.number().int().min(1).max(999).default(1),
    costPrice: z.coerce.number().min(0).max(99_999_999).optional().nullable(),
    salePrice: z.coerce.number().min(0).max(99_999_999),
    discountRate: z.coerce.number().min(0).max(1).default(0),
    channelFeePct: z.coerce.number().min(0).max(1).default(0),
    shippingCost: z.coerce.number().min(0).max(99_999_999).default(0),
    packagingCost: z.coerce.number().min(0).max(99_999_999).default(0),
    adCostPct: z.coerce.number().min(0).max(1).default(0),
    operatingCostPct: z.coerce.number().min(0).max(1).default(0),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => v.optionId != null || (v.manualName != null && v.manualName.trim().length > 0), {
    message: 'optionId 또는 manualName 중 하나는 필수입니다',
    path: ['optionId'],
  })
export type PricingScenarioItemInput = z.infer<typeof pricingScenarioItemSchema>

// channels[] 항목 스키마 — channelId(등록 채널) 또는 channelInline(임시 인라인 채널) 중 하나
// 서버는 channelId만 처리하며 channelInline은 수신 후 무시 (DB 컬럼 없음, PR-5에서 정교화 예정)
export const pricingScenarioChannelEntrySchema = z
  .object({
    channelId: z.string().min(1).optional().nullable(),
    // channelInline: 클라이언트가 임시 채널 정보를 함께 보낼 때 사용 (서버는 현재 무시)
    channelInline: z.record(z.string(), z.unknown()).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => v.channelId != null || v.channelInline != null, {
    message: 'channelId 또는 channelInline 중 하나는 필수입니다',
  })
export type PricingScenarioChannelEntryInput = z.infer<typeof pricingScenarioChannelEntrySchema>

export const pricingScenarioSchema = z.object({
  name: z.string().trim().min(1).max(100),
  memo: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v?.length ? v : undefined)),
  // 레거시 단일 채널 (하위 호환 유지)
  channelId: z.string().min(1).optional().nullable(),
  // 레거시 M-N 채널 ID 배열 (하위 호환 유지)
  channelIds: z.array(z.string().min(1)).max(20).optional(),
  // 신규 채널 배열 (channelId 또는 channelInline 객체) — channels가 있으면 channelIds 대신 사용
  channels: z.array(pricingScenarioChannelEntrySchema).max(20).optional(),
  includeVat: z.boolean().default(true),
  vatRate: z.coerce.number().min(0).max(1).default(0.1),
  promotionType: z.enum(['NONE', 'FLAT', 'PERCENT', 'COUPON', 'MIN_PRICE']).default('NONE'),
  promotionValue: z.coerce.number().min(0).max(99_999_999).optional().nullable(),
  applyReturnAdjustment: z.boolean().default(false),
  items: z.array(pricingScenarioItemSchema).min(1).max(100),
})
export type PricingScenarioInput = z.infer<typeof pricingScenarioSchema>

export const pricingScenarioPatchSchema = pricingScenarioSchema.partial()
export type PricingScenarioPatchInput = z.infer<typeof pricingScenarioPatchSchema>

// 여러 listing 일괄 수정 — 판매가·상태만 현재 지원
export const productListingBulkPatchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  patch: z
    .object({
      retailPrice: z
        .preprocess(
          (v) => (v === null || v === '' ? null : v === undefined ? undefined : Number(v)),
          z.union([z.number().min(0).max(99_999_999), z.null()])
        )
        .optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    })
    .refine((p) => p.retailPrice !== undefined || p.status !== undefined, {
      message: '변경할 필드가 없습니다',
    }),
})
export type ProductListingBulkPatchInput = z.infer<typeof productListingBulkPatchSchema>
