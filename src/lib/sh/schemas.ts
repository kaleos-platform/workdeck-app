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
  // .optional()은 inner schema에 적용해야 preprocess 결과(undefined)도 허용됨
  nameEn: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().max(200).optional()
  ),
  code: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().max(100).optional()
  ),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  // 공급원가를 완료 생산 차수 가중평균 단가로 파생 표시할지 여부
  useProductionCost: z.boolean().optional(),
  brandId: z.preprocess((v) => (v === null || v === '' ? undefined : v), idLike.optional()),
  // 카테고리 — POST에선 required, PATCH에선 partial()로 optional이 된다.
  groupId: z.preprocess((v) => (v === null || v === '' ? undefined : v), idLike),
  manufacturer: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().max(200).optional()
  ),
  manufactureCountry: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().max(100).optional()
  ),
  // date-only(YYYY-MM-DD) / ISO datetime / null / '' 모두 허용
  manufactureDate: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z
      .string()
      .refine((s) => !Number.isNaN(new Date(s).getTime()), '유효한 날짜가 아닙니다')
      .optional()
  ),
  features: z.array(z.string()).optional(),
  // 프론트가 문자열 배열로 전송 — 인증번호 한 줄씩
  certifications: z.array(z.string()).optional(),
  msrp: z.preprocess(
    (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
    z.number().nonnegative().optional()
  ),
  description: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().max(2000).optional()
  ),
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

// 채널 등록·수정 시 함께 보내는 카테고리별 수수료 입력 (% 단위 0~100)
export const channelFeeRateInput = z.object({
  categoryName: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).max(50)
  ),
  ratePercent: z.preprocess(
    (v) => (v === null || v === '' || v === undefined ? 0 : Number(v)),
    z.number().min(0).max(100)
  ),
})
export type ChannelFeeRateInputItem = z.infer<typeof channelFeeRateInput>

export const channelSchema = z.object({
  name: z.string().min(1).max(100),
  // 사용자 정의 채널 유형 (필수 — 시드 4개 중 하나 또는 사용자 추가 유형)
  channelTypeDefId: z.preprocess(toUndef, idLike),
  isActive: z.boolean().default(true),
  // 가격 시뮬레이션 사용 여부 (false면 수수료/배송 필드는 선택)
  useSimulation: z.boolean().default(true),
  // adminUrl/숫자 필드: null/'' 입력을 undefined로 정규화한 뒤 inner schema가 undefined도 허용하도록
  // .optional()은 반드시 inner schema에 붙여야 함 (preprocess 결과가 undefined여도 통과)
  adminUrl: z.preprocess(toUndef, z.string().url().optional()),
  freeShipping: z.boolean().default(false),
  freeShippingThreshold: z.preprocess(toOptionalNumber, z.number().nonnegative().optional()),
  usesMarketingBudget: z.boolean().default(false),
  applyAdCost: z.boolean().default(false),
  // 채널별 광고비율 rate (=1/ROAS, UI는 목표 ROAS%로 표시). null=미설정=광고 미적용.
  // max 2 = ROAS 50%까지 허용(ratio-vs-% 오타 방어). Decimal(6,4)와 정합.
  adCostPct: z.preprocess(toOptionalNumber, z.number().min(0).max(2).optional()),
  shippingFeeType: z.enum(['FIXED', 'PERCENT']).default('FIXED'),
  shippingFee: z.preprocess(toOptionalNumber, z.number().nonnegative().optional()),
  shippingFeePct: z.preprocess(toOptionalNumber, z.number().min(0).max(1).optional()),
  vatIncludedInFee: z.boolean().default(true),
  paymentFeeIncluded: z.boolean().default(true),
  paymentFeePct: z.preprocess(toOptionalNumber, z.number().min(0).max(1).optional()),
  requireOrderNumber: z.boolean().default(true),
  requirePayment: z.boolean().default(true),
  requireProducts: z.boolean().default(true),
  // 채널 자체 배송(연동) 채널의 대표 채널. ''/null=해제, 문자열=설정, undefined=미변경.
  // 소속·externalSource·self 검증은 라우트에서 수행.
  representativeChannelId: z
    .preprocess((v) => (v === '' ? null : v), z.union([idLike, z.null()]))
    .optional(),
  // 카테고리별 수수료 — 비어있거나 미전달 시 서버가 [{ '기본', 0 }] 자동 추가
  feeRates: z.array(channelFeeRateInput).max(50).optional(),
})
export type ChannelInput = z.infer<typeof channelSchema>

// ─── 채널 유형 정의 ─────────────────────────────────────────────────────────

export const channelTypeDefSchema = z.object({
  name: z.string().min(1).max(100),
  isSalesChannel: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().optional(),
})
export type ChannelTypeDefInput = z.infer<typeof channelTypeDefSchema>

// ─── 채널 수수료율 (개별 라우트용 — 채널 수정 다이얼로그가 통합 처리하므로 폐기 예정) ───
// 호환을 위해 유지하되 vatIncluded는 제거되어 채널의 vatIncludedInFee가 단일 출처가 됨

export const channelFeeRateSchema = z.object({
  categoryName: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1, '카테고리를 선택하세요').max(100)
  ),
  ratePercent: z.preprocess(
    (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(100)
  ),
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
  // VAT (0~1 비율 단위)
  defaultIncludeVat: z.boolean().default(true),
  defaultVatRate: z.coerce.number().min(0).max(1).default(0.1),
  autoApplyChannelFee: z.boolean().default(false),
  autoApplyAdCost: z.boolean().default(false),
  autoApplyShipping: z.boolean().default(false),
  // 마진 등급 임계값 — 0~1 비율 단위 (단일 기준)
  platformTargetGood: z.number().min(0).max(1).default(0.25),
  platformTargetFair: z.number().min(0).max(1).default(0.15),
  minimumAcceptableMargin: z.number().min(0).max(1).default(0.1),
  // 적정 원가율 상한 (0~1) — KPI 원가율 경고 임계
  maxCostRatio: z.number().min(0).max(1).default(0.33),
})
export type PricingSettingsInput = z.infer<typeof pricingSettingsSchema>

// ─── 판매채널 상품 (ProductListing) ──────────────────────────────────────────
// 채널별 상품 묶음. 구성 옵션 1~50개, 키워드 최대 30개, 상품명 200자 소프트 상한.

const listingNameSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : v),
  z.string().min(1, '상품명을 입력하세요').max(200)
)
const listingOptionalNameSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : v),
  z.string().max(200)
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
    channelProductId: idLike,
    internalCode: emptyToUndefined.pipe(z.string().trim().max(50)).optional(),
    searchName: listingNameSchema,
    displayName: listingOptionalNameSchema.optional().default(''),
    managementName: emptyToUndefined.pipe(z.string().trim().max(200)).optional(),
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
    channelStock: z
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
    displayName: listingOptionalNameSchema.optional(),
    managementName: z
      .preprocess((v) => (v === '' ? null : v), z.union([z.string().trim().max(200), z.null()]))
      .optional(),
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
    channelStock: z
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
  costMode: z.enum(['TOTAL', 'BREAKDOWN']).default('TOTAL'),
  totalCost: z.coerce.number().min(0).max(99_999_999_999).optional(),
  memo: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v?.length ? v : undefined)),
  // 생산 상태 — default 없음 (PATCH 시 기존값 보존을 위해)
  status: z.enum(['PLANNED', 'ORDERED', 'STOCKED_IN']).optional(),
  // 대표 브랜드 — null = 명시적 미지정, undefined = 변경 없음(PATCH)
  brandId: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).nullable()).optional(),
  // 납기일 / 완료일 — YYYY-MM-DD 문자열 또는 null
  dueAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable()).optional(),
  completedAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable()).optional(),
  // 연계 발주 계획 — 발주 계획에서 생산차수 생성 시 링크 (재고 흐름, 신뢰도와 무관)
  reorderPlanId: z.string().min(1).optional(),
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
  // 세트 기반 차수(연동 위치 세트 계획에서 생성) — listing(=세트)별 계획 세트수량.
  // items(옵션별)는 이 세트들의 분해 결과. 비-세트 차수는 미전달(undefined).
  sets: z
    .array(z.object({ listingId: z.string().min(1), plannedSetQty: z.number().int().min(0) }))
    .max(200)
    .optional(),
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
  // 단계별 일자 — 사용자가 수정 가능. 빈 문자열은 null 로 치환, undefined 는 변경 없음.
  orderedConfirmedAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable()).optional(),
  stockedInAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable()).optional(),
})
export type ProductionRunPatchInput = z.infer<typeof productionRunPatchSchema>

// 상태 전환 전용 스키마 — POST /api/sh/production-runs/[runId]/transition
export const productionRunStatusTransitionSchema = z
  .object({
    status: z.enum(['PLANNED', 'ORDERED', 'STOCKED_IN']),
    transitionDate: z.string().min(1), // YYYY-MM-DD
    // STOCKED_IN 전환 시 옵션별 보관 위치 분배. 옵션 하나를 여러 위치로 나눠 입고 가능.
    // 실입고량은 발주 수량과 달라도 됨(양방향). 미입고 옵션은 allocation 부재로 표현(빈 배열 허용).
    // 0개 행은 무의미하므로 quantity 는 양수 유지.
    allocations: z
      .array(
        z.object({
          optionId: z.string().min(1),
          locationId: z.string().min(1),
          quantity: z.number().int().positive(),
        })
      )
      .optional(),
    // 세트 단위 입고 — 세트(listing)별 입고 세트수 + 입고 위치. 서버가 구성옵션으로 분해해
    // allocations 를 만든다. 세트 기반 차수 전용. 값이 있으면 allocations 대신 이 분해를 쓴다.
    setStockIns: z
      .array(
        z.object({
          listingId: z.string().min(1),
          locationId: z.string().min(1),
          setQty: z.number().int().positive(),
        })
      )
      .optional(),
  })
  .superRefine((v, ctx) => {
    // 입고완료 시 allocations 또는 setStockIns 중 하나는 있어야 함(빈 배열 = 전 옵션 미입고, 허용)
    if (v.status === 'STOCKED_IN' && v.allocations === undefined && v.setStockIns === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: '입고완료 전환 시 옵션별 또는 세트별 입고 정보가 필요합니다',
        path: ['allocations'],
      })
    }
  })
export type ProductionRunStatusTransitionInput = z.infer<typeof productionRunStatusTransitionSchema>

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

// ─── 시나리오 저장 (스냅샷 방식) ────────────────────────────────────────────────
// 라이브 시뮬 상태 전체를 inputSnapshot(JSON)에 무손실 저장한다.
// productIds는 상품 단위 조회(상품 상세/시뮬 패널)를 위한 역인덱스.
export const pricingScenarioSaveSchema = z.object({
  name: z.string().trim().min(1).max(100),
  memo: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v?.length ? v : undefined)),
  productIds: z.array(z.string().min(1)).max(50).default([]),
  // 클라이언트가 생성한 스냅샷 JSON — 구조 검증은 최소(자체 생성 데이터)
  inputSnapshot: z.record(z.string(), z.unknown()),
})
export type PricingScenarioSaveInput = z.infer<typeof pricingScenarioSaveSchema>

export const pricingScenarioSavePatchSchema = pricingScenarioSaveSchema.partial()
export type PricingScenarioSavePatchInput = z.infer<typeof pricingScenarioSavePatchSchema>

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
      channelStock: z
        .preprocess(
          (v) => (v === null || v === '' ? null : v === undefined ? undefined : Number(v)),
          z.union([z.number().int().min(0).max(999_999), z.null()])
        )
        .optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    })
    .refine(
      (p) => p.retailPrice !== undefined || p.channelStock !== undefined || p.status !== undefined,
      {
        message: '변경할 필드가 없습니다',
      }
    ),
})
export type ProductListingBulkPatchInput = z.infer<typeof productListingBulkPatchSchema>
