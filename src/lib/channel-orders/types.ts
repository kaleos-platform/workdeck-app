import { z } from 'zod'

export const ADAPTERS = ['naver', 'coupang', 'cafe24'] as const
export type Adapter = (typeof ADAPTERS)[number]

export const LEASE_MS = 15 * 60 * 1000
const DAY = 86_400_000
export const BACKFILL_DAYS = 14
export const SCAN_DAYS = 7

/** 채널별 조회 창 한도·겹침(plan 2-2). */
export const ADAPTER_WINDOW: Record<Adapter, { windowMs: number; overlapMs: number }> = {
  naver: { windowMs: DAY, overlapMs: 60 * 60 * 1000 },
  coupang: { windowMs: DAY, overlapMs: 3 * DAY },
  cafe24: { windowMs: DAY, overlapMs: 3 * DAY },
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
