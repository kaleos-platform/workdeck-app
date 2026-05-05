/**
 * 판매채널 상품 그룹 키 계산 헬퍼.
 *
 * 같은 product × channel 안에서 listing들을 묶을 때, listing의 managementName/searchName에서
 * 옵션 속성값과 번들 세트 수량 차원("N개")을 제거해 공통 base 부분만 남긴다. 이 base가 그룹 키.
 *
 * 예: managementName = "펠트 수납박스 번들 L(38X24X23) 차콜 1개"
 *     attrs suffix    = "L(38X24X23) 차콜"
 *     → strip → "펠트 수납박스 번들"
 */

export function computeListingGroupKey(params: {
  managementName: string | null
  searchName: string | null
  attributeValues: Record<string, string>
  productAttrs: Array<{ name: string }>
  listingId: string
}): string {
  const { managementName, searchName, attributeValues, productAttrs, listingId } = params
  const suffix = productAttrs
    .map((a) => attributeValues[a.name])
    .filter(Boolean)
    .join(' ')
  return (
    stripSuffix(managementName, suffix) ||
    stripSuffix(searchName, suffix) ||
    `__listing_${listingId}`
  )
}

/**
 * listing 이름에서 옵션 속성 suffix, 번들 수량(`N개`), 묶음 라벨(`#N ...`)을
 * 모두 제거한 base를 반환. 매칭되지 않으면 그대로 반환.
 *
 * 묶음 라벨 예: " #1 블랙×2", " #3 화이트×1 + 블랙×1"
 */
function stripSuffix(value: string | null, attrSuffix: string): string {
  if (!value) return ''
  let v = value
  // 끝의 묶음 라벨 (` #N ...`) 제거 — advanced 모드 묶음 차원
  v = v.replace(/\s+#\d+\s.*$/, '')
  // 끝의 ` N개` (예: " 1개", " 12개") 제거 — simple 모드 번들 세트 수량 차원
  v = v.replace(/\s+\d+개$/, '')
  // 옵션 속성값 suffix 제거
  if (attrSuffix && v.endsWith(attrSuffix)) {
    v = v.slice(0, v.length - attrSuffix.length).trimEnd()
  }
  return v
}
