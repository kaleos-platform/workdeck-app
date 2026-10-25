// 보관 장소 외부 데이터 소스 매핑 식별자.
// InvStorageLocation.externalSource 컬럼에 저장되는 값 enum.

export const EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH = 'coupang_rocket_growth' as const

export const EXTERNAL_SOURCES = [EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH] as const
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number]

export const EXTERNAL_SOURCE_LABEL: Record<ExternalSource, string> = {
  coupang_rocket_growth: '쿠팡 로켓그로스',
}

export function isExternalSource(v: unknown): v is ExternalSource {
  return typeof v === 'string' && (EXTERNAL_SOURCES as readonly string[]).includes(v)
}

// 스마트스토어 N배송: 보관장소가 아닌 채널 전용 소스 (스토어별 `naver_nbaesong:{storeKey}`).
export const NBAESONG_SOURCE_PREFIX = 'naver_nbaesong:'

export function nbaesongExternalSource(storeKey: string): string {
  return `${NBAESONG_SOURCE_PREFIX}${storeKey}`
}

export function isNbaesongSource(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.startsWith(NBAESONG_SOURCE_PREFIX) &&
    v.length > NBAESONG_SOURCE_PREFIX.length
  )
}

export function nbaesongStoreKey(source: string): string | null {
  return isNbaesongSource(source) ? source.slice(NBAESONG_SOURCE_PREFIX.length) : null
}

export function channelSourceLabel(v: string | null | undefined): string | null {
  if (isExternalSource(v)) return EXTERNAL_SOURCE_LABEL[v]
  if (isNbaesongSource(v)) return '스마트스토어 N배송'
  return null
}
