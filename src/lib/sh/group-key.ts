/**
 * 판매채널 상품 그룹 키 계산 헬퍼.
 *
 * 같은 product × channel 안에서 listing들을 묶을 때, listing의 managementName/searchName에서
 * 옵션 속성값과 번들 세트 수량("N개"), 묶음 라벨("#N ...")을 모두 제거해 공통 base 부분만 남긴다.
 *
 * 단일 item / 묶음 item / advanced 모드(수량 지정 속성은 묶음 라벨로 분리, 미선택 속성만
 * listing 이름 끝에 들어감) 등 다양한 케이스를 모두 다루기 위해, 알려진 product attribute
 * 값 집합을 받아 listing 이름 끝에서 매치되는 값을 가능한 만큼 반복적으로 제거한다.
 *
 * 예) "캡나시 2개 세트 XL(105) #3 화이트×1 + 블랙×1"
 *      → " #3 ..." 제거 → "캡나시 2개 세트 XL(105)"
 *      → 끝의 "XL(105)"가 사이즈 값 집합에 있음 → 제거 → "캡나시 2개 세트"
 * 예) "펠트 수납박스 번들 L(38X24X23) 차콜 1개"
 *      → " 1개" 제거 → "펠트 수납박스 번들 L(38X24X23) 차콜"
 *      → "차콜"이 색상 값 집합에 있음 → 제거 → "펠트 수납박스 번들 L(38X24X23)"
 *      → "L(38X24X23)"가 사이즈 값 집합에 있음 → 제거 → "펠트 수납박스 번들"
 */

export type ProductAttrDef = { name: string; values?: Array<{ value: string }> }

export function computeListingGroupKey(params: {
  managementName: string | null
  searchName: string | null
  itemAttributeValues: Array<Record<string, string>>
  productAttrs: Array<ProductAttrDef>
  listingId: string
}): string {
  const { managementName, searchName, itemAttributeValues, productAttrs, listingId } = params
  // listing item들이 가진 모든 속성값과 product 정의의 모든 값을 합집합으로 사용
  const knownValues = collectKnownValues(itemAttributeValues, productAttrs)
  return (
    stripSuffix(managementName, knownValues) ||
    stripSuffix(searchName, knownValues) ||
    `__listing_${listingId}`
  )
}

function collectKnownValues(
  items: Array<Record<string, string>>,
  productAttrs: Array<ProductAttrDef>
): Set<string> {
  const set = new Set<string>()
  for (const it of items) {
    for (const v of Object.values(it)) {
      if (v) set.add(v)
    }
  }
  for (const a of productAttrs) {
    for (const v of a.values ?? []) {
      if (v.value) set.add(v.value)
    }
  }
  return set
}

/**
 * listing 이름에서 묶음 라벨, 번들 수량, 끝에서부터 매치되는 attribute value들을
 * 반복 제거한 base를 반환.
 */
function stripSuffix(value: string | null, knownValues: Set<string>): string {
  if (!value) return ''
  let v = value
  // 끝의 묶음 라벨 (` #N ...`) 제거 — advanced 모드 묶음 차원
  v = v.replace(/\s+#\d+\s.*$/, '')
  // 끝의 ` N개` (예: " 1개", " 12개") 제거 — simple 모드 번들 세트 수량 차원
  v = v.replace(/\s+\d+개$/, '')
  // 끝에서부터 매치되는 attribute value를 가능한 만큼 반복 제거
  let changed = true
  while (changed) {
    changed = false
    for (const known of knownValues) {
      if (!known) continue
      if (v === known) {
        v = ''
        changed = true
        break
      }
      const sep = ' '
      if (v.endsWith(sep + known)) {
        v = v.slice(0, v.length - known.length - sep.length).trimEnd()
        changed = true
        break
      }
    }
  }
  return v
}
