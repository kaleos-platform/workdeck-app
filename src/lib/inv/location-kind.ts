// 위치 종류 판정 — prisma 미의존(클라이언트 번들에서도 쓴다)

/** 외부 물류 위치 = 3PL 이거나 외부 연동(쿠팡 로켓그로스 등) 위치 */
export function isExternalLogisticsLocation(loc: {
  type: string
  externalSource?: string | null
}): boolean {
  return loc.type === 'THIRD_PARTY' || loc.externalSource != null
}
