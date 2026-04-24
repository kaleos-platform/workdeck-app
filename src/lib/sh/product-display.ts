/**
 * 상품 표시명 계산 — 내부 UI는 관리 상품명(internalName)을 우선 쓰고,
 * 없으면 공식 상품명(name)으로 fallback.
 *
 * - 검색/식별 UX는 관리명 기준이지만, 빈 관리명을 허용해야 하므로 여기서 흡수.
 * - 판매채널·배송 파일 등 고객 대상 출력에는 명시적으로 `name`(공식명) 을 쓰도록
 *   호출부에서 분리해야 한다 — 이 헬퍼는 "내부 식별용 표시명" 전용이다.
 */
export function productDisplayName(p: { name: string; internalName?: string | null }): string {
  const internal = p.internalName?.trim()
  return internal && internal.length > 0 ? internal : p.name
}
