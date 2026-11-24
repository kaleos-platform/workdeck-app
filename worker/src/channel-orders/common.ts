/**
 * 채널 주문 관측 수집기 공용 — 오류 종류, 행 타입, 응답 파싱 도우미.
 * 앱 src/ 는 import 할 수 없어 행 모양을 로컬에 복사했다(원본: src/lib/channel-orders/types.ts
 * OrderLineInputSchema·ScanLineInputSchema — 앱 쪽 테스트가 출력이 스키마를 통과하는지 검사한다).
 */

/** 응답 구조가 기대와 다르다 — 빈 결과로 넘기지 않고 실패시킨다(structure_invalid). */
export class StructureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StructureError'
  }
}
/** 외부 API 가 2xx 가 아니다. 메시지에 비밀값을 넣지 않는다. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
/** 자격증명 없음·불일치·토큰 실패(auth_error). */
export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}
/** operation 마감 시한 초과(timeout). */
export class DeadlineError extends Error {
  constructor() {
    super('operation 마감 시한 초과')
    this.name = 'DeadlineError'
  }
}

export type OrderLine = {
  externalLineKey: string
  externalOrderId: string
  paidAt: string
  productName: string
  optionText: string | null
  quantity: number
  channelStatus: string
  claimStatus: string | null
  deliveryKind: string
  shippingDueAt: string | null
  carrierCode: string | null
  trackingNumber: string | null
  dispatchedAt: string | null
  sourceChangedAt: string | null
}
export type ScanLine = {
  externalLineKey: string
  externalOrderId: string
  quantity: number
  channelStatus: string
  paidAt: string
}
export type TimeWindow = { from: string; to: string }

/** 러너가 수집기에 주는 훅. 카운터 규칙(plan §2)은 러너가 지킨다. */
export type Hooks<L> = {
  /** 외부 목록 페이지 요청 직전 — pagesRequested++ 하고 마감 시한을 확인한다. */
  request: () => void
  /** 외부 하위 요청(단건 조회 등) 직전 마감 시한만 확인. */
  check: () => void
  /** 외부 요청 1건의 제한 시간(ms) = min(60초, 남은 마감 시한). 없으면 클라이언트 기본값. */
  timeoutMs?: () => number
  /** 그 페이지의 행 전부 ingest(빈 페이지도 1회) 후 pagesIngested++. */
  page: (lines: L[]) => Promise<void>
}

export const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
export const text = (v: unknown): string | null =>
  typeof v === 'string' && v !== ''
    ? v
    : typeof v === 'number' && Number.isFinite(v)
      ? String(v)
      : null
/** ingest 스키마 한도에 맞춰 자른다. 키·ID 는 자르지 않는다(충돌 방지). */
export const clip = (v: unknown, max: number): string | null => text(v)?.slice(0, max) ?? null

/** 오프셋 없는 문자열은 KST 로 본다. 해석 불가면 null. */
export function iso(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  const full = /^\d{4}-\d\d-\d\d$/.test(s) ? `${s}T00:00:00` : s
  const t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(full) ? full : `${full.replace(' ', 'T')}+09:00`)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

const KST = 9 * 3_600_000
/** ISO 시각 → KST 날짜(yyyy-MM-dd). */
export const kstDay = (isoStr: string | number): string =>
  new Date((typeof isoStr === 'number' ? isoStr : Date.parse(isoStr)) + KST)
    .toISOString()
    .slice(0, 10)
/** ISO 시각 → `yyyy-MM-ddTHH:mm:ss.SSS+09:00`. */
export const kstOffset = (isoStr: string): string =>
  `${new Date(Date.parse(isoStr) + KST).toISOString().slice(0, 23)}+09:00`
