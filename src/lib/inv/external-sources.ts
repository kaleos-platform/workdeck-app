// 보관 장소 외부 데이터 소스 매핑 식별자.
// InvStorageLocation.externalSource 컬럼에 저장되는 값 enum.

export const EXTERNAL_SOURCES = ['coupang_rocket_growth'] as const
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number]

export const EXTERNAL_SOURCE_LABEL: Record<ExternalSource, string> = {
  coupang_rocket_growth: '쿠팡 로켓그로스',
}

export function isExternalSource(v: unknown): v is ExternalSource {
  return typeof v === 'string' && (EXTERNAL_SOURCES as readonly string[]).includes(v)
}
