import { z } from 'zod'

export const ADAPTERS = ['naver', 'coupang', 'cafe24'] as const
export type Adapter = (typeof ADAPTERS)[number]

export const LEASE_MS = 15 * 60 * 1000
const DAY = 86_400_000
export const BACKFILL_DAYS = 14
export const SCAN_DAYS = 7
/** 한 번의 증분 관측이 처리하는 최대 창 수(서버가 start 에서 계획한다). */
export const OBSERVE_MAX_WINDOWS = 20
/** ingest 한 번에 받는 최대 행 수 — 넘으면 400. */
export const MAX_INGEST_LINES = 300
const KST = 9 * 3_600_000
/** t(ms) 가 속한 KST 날짜의 00:00(ms). */
export const kstMidnight = (t: Date | number): number =>
  Math.floor((new Date(t).getTime() + KST) / DAY) * DAY - KST

/** 채널별 조회 창 한도·겹침(plan 2-2). */
export const ADAPTER_WINDOW: Record<Adapter, { windowMs: number; overlapMs: number }> = {
  naver: { windowMs: DAY, overlapMs: 60 * 60 * 1000 },
  // cafe24 와 같은 이유: 증분이 전수 창(7일)+1일을 다시 읽어 4~7일 된 주문의 상태 변화도 관측한다.
  coupang: { windowMs: DAY, overlapMs: 8 * DAY },
  // 전수 창(7일)+1일: 증분이 미종결 행을 매번 다시 읽어 관측 상태가 전수 조회보다 낡지 않게 한다(plan 2-2 미종결 재조회).
  cafe24: { windowMs: DAY, overlapMs: 8 * DAY },
}

export type OperationKind = 'OBSERVE' | 'FULL_SCAN' | 'RECONCILE'
export type OperationStatus = 'STARTED' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED'

/** operation.error 에 넣을 수 있는 코드(자유 문구·원문 금지). */
export const ERROR_CODES = [
  'timeout',
  'worker_failed',
  'structure_invalid',
  'api_error',
  'auth_error',
  'lease_lost',
  'plan_mismatch',
  'ingest_missing',
  'invalid',
  'busy',
  'setting_changed',
  'not_found',
  'unknown',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
export const toErrorCode = (v: unknown): ErrorCode =>
  (ERROR_CODES as readonly string[]).includes(v as string) ? (v as ErrorCode) : 'unknown'

export type ObserveCursor = { at: string; catchingUp: boolean }
export type ObserveLease = { operationId: string; until: number }

const dateStr = z.iso.datetime({ offset: true })
const str = z.string().min(1).max(300)

/**
 * 관측 행 입력. strict — 수령인·연락처·주소 같은 알 수 없는 키는 통째로 거부한다.
 */
export const OrderLineInputSchema = z
  .object({
    externalLineKey: str,
    externalOrderId: str,
    paidAt: dateStr,
    productName: z.string().max(500),
    optionText: z.string().max(500).nullish(),
    quantity: z.number().int().min(0).max(100000),
    channelStatus: str,
    claimStatus: z.string().max(100).nullish(),
    deliveryKind: str,
    shippingDueAt: dateStr.nullish(),
    carrierCode: z.string().max(100).nullish(),
    trackingNumber: z.string().max(100).nullish(),
    dispatchedAt: dateStr.nullish(),
    sourceChangedAt: dateStr.nullish(),
  })
  .strict()
export type OrderLineInput = z.infer<typeof OrderLineInputSchema>

export const ScanLineInputSchema = z
  .object({
    externalLineKey: str,
    externalOrderId: str,
    quantity: z.number().int().min(0).max(100000),
    channelStatus: str,
    paidAt: dateStr,
  })
  .strict()
export type ScanLineInput = z.infer<typeof ScanLineInputSchema>

export class ChannelOrderError extends Error {
  constructor(
    readonly code: 'lease_lost' | 'not_found' | 'invalid' | 'busy',
    message: string
  ) {
    super(message)
    this.name = 'ChannelOrderError'
  }
}

// ─── 설정(대사 방식·매칭 키) ───────────────────────────────────────────────────

export const MATCH_FIELDS = ['externalOrderId', 'externalLineKey', 'lineKeyOrderPart'] as const
export type MatchField = (typeof MATCH_FIELDS)[number]
export type MatchRule = { field: MatchField } | null

export const MatchRuleSchema = z.object({ field: z.enum(MATCH_FIELDS) }).strict()

/** 저장된 matchKeyRule(Json) 을 검증해 읽는다. 형식이 깨졌으면 null(= 대사에서 C). */
export const parseMatchRule = (raw: unknown): MatchRule => {
  const r = MatchRuleSchema.safeParse(raw)
  return r.success ? r.data : null
}

/** 설정 PUT 본문. 라우트가 ADMIN 만 통과시킨다. reconcileMode·matchKeyRule 은 생략하면 기존 값을 유지한다. */
export const ObserveSettingBodySchema = z
  .object({
    observeEnabled: z.boolean(),
    adapter: z.enum(ADAPTERS),
    storeKey: z.string().trim().max(100).nullish(),
    reconcileMode: z.enum(['diagnose', 'judge']).optional(),
    matchKeyRule: MatchRuleSchema.nullish(),
  })
  .refine((v) => v.adapter !== 'naver' || !v.observeEnabled || !!v.storeKey, {
    message: '네이버는 스토어 키가 필요합니다',
    path: ['storeKey'],
  })
  .refine((v) => v.adapter !== 'cafe24' || !v.observeEnabled || !!v.storeKey, {
    message: '카페24는 쇼핑몰을 선택해야 합니다',
    path: ['storeKey'],
  })
