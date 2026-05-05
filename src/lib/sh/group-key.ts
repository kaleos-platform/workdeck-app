/**
 * 판매채널 상품 그룹 키 계산 헬퍼.
 *
 * 같은 product × channel 안에서 listing들을 묶을 때, listing의 managementName/searchName에서
 * 옵션 속성값(공통값)과 번들 세트 수량("N개"), 묶음 라벨("#N ...")을 모두 제거해 공통 base
 * 부분만 남긴다. 이 base가 그룹 키.
 *
 * 핵심: 한 listing이 여러 item을 가질 수 있고(advanced 모드 묶음), 그 경우 listing 이름에는
 * 모든 item이 공통으로 가지는 속성값만 들어간다. 따라서 그룹키 계산 시에도 "모든 item이 같은
 * 값을 가지는 속성"만 suffix로 인정해야 한다.
 *
 * 예 (단일 item):  managementName = "펠트 수납박스 번들 L(38X24X23) 차콜 1개"
 *                    items[0].attrs = { 사이즈: "L(38X24X23)", 색상: "차콜" }
 *                    → 공통 suffix = "L(38X24X23) 차콜" → strip → "펠트 수납박스 번들"
 * 예 (묶음 item):  managementName = "캡나시 2개 세트 XL(105) #3 화이트×1 + 블랙×1"
 *                    items[0].attrs = { 사이즈: "XL(105)", 색상: "화이트" }
 *                    items[1].attrs = { 사이즈: "XL(105)", 색상: "블랙" }
 *                    공통: 사이즈만 동일 → suffix = "XL(105)"
 *                    → strip → "캡나시 2개 세트"
 */

export function computeListingGroupKey(params: {
  managementName: string | null
  searchName: string | null
  itemAttributeValues: Array<Record<string, string>>
  productAttrs: Array<{ name: string }>
  listingId: string
}): string {
  const { managementName, searchName, itemAttributeValues, productAttrs, listingId } = params
  const suffix = productAttrs
    .map((a) => commonValue(itemAttributeValues, a.name))
    .filter((v): v is string => Boolean(v))
    .join(' ')
  return (
    stripSuffix(managementName, suffix) ||
    stripSuffix(searchName, suffix) ||
    `__listing_${listingId}`
  )
}

/**
 * 모든 item이 같은 값을 가지면 그 값을, 다르면 null을 반환.
 * 빈 배열일 때도 null.
 */
function commonValue(items: Array<Record<string, string>>, name: string): string | null {
  if (items.length === 0) return null
  const first = items[0]?.[name]
  if (!first) return null
  for (const it of items) {
    if (it[name] !== first) return null
  }
  return first
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
