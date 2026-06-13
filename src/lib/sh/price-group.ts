// 가격 그룹핑 유틸리티
// 원가·소매가 조합이 동일한 옵션들을 묶어 PriceGroup 배열로 반환하는 순수 함수.

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export type OptionInput = {
  optionId: string
  optionName: string
  costPrice: number | null
  retailPrice: number | null
  attributeValues?: Record<string, string> | null // e.g. {"사이즈":"L","색상":"파랑"}
  sizeLabel?: string | null
}

export type PriceGroup = {
  key: string // 정규화된 식별 키 (float equality 회피)
  costPrice: number | null
  retailPrice: number | null
  sharedLabel: string // e.g. "26,000원 (L)"
  optionIds: string[] // 이 그룹의 모든 optionId (입력 순서 유지)
  representativeOptionId: string // 그룹 첫 번째 옵션 ID
  priceUndefined: boolean // costPrice 또는 retailPrice 가 null이면 true
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

/** 가격(원)을 정수 원으로 정규화. null → "null" 토큰 */
function priceToken(v: number | null): string {
  if (v === null) return 'null'
  return String(Math.round(v))
}

/** 그룹 키 생성: "{costToken}|{retailToken}" */
function makeKey(costPrice: number | null, retailPrice: number | null): string {
  return `${priceToken(costPrice)}|${priceToken(retailPrice)}`
}

/**
 * 옵션 집합에서 모든 멤버에 걸쳐 값이 동일한 attributeValues 키를 찾는다.
 * attributeValues 없는 멤버는 sizeLabel 로 폴백한다.
 */
function findSharedAttributes(options: OptionInput[]): Record<string, string> {
  if (options.length === 0) return {}

  // 모든 멤버의 attributeValues 수집 (없으면 sizeLabel을 "사이즈" 키로 폴백)
  const attrMaps: Array<Record<string, string>> = options.map((o) => {
    if (o.attributeValues && Object.keys(o.attributeValues).length > 0) {
      return o.attributeValues
    }
    if (o.sizeLabel) {
      return { 사이즈: o.sizeLabel }
    }
    return {}
  })

  if (attrMaps.length === 0) return {}

  // 첫 번째 멤버의 키를 기준으로 교집합 탐색
  const firstKeys = Object.keys(attrMaps[0])
  const shared: Record<string, string> = {}

  for (const key of firstKeys) {
    const referenceValue = attrMaps[0][key]
    // 모든 멤버에서 같은 키가 같은 값을 가지면 공유 속성
    const allSame = attrMaps.every((m) => m[key] === referenceValue)
    if (allSame) {
      shared[key] = referenceValue
    }
  }

  return shared
}

/** 소매가를 한국어 천단위 포맷으로 변환 */
function fmtPrice(v: number): string {
  return `${Math.round(v).toLocaleString('ko-KR')}원`
}

/** PriceGroup 의 sharedLabel 생성 */
function makeSharedLabel(
  retailPrice: number | null,
  priceUndefined: boolean,
  sharedAttrs: Record<string, string>
): string {
  const attrPart =
    Object.values(sharedAttrs).length > 0 ? ` (${Object.values(sharedAttrs).join(', ')})` : ''

  if (priceUndefined) {
    return `가격 미정 (원가 직접 입력 필요)${attrPart}`
  }

  return `${fmtPrice(retailPrice!)}${attrPart}`
}

// ─── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 원가·소매가가 동일한 옵션들을 묶어 PriceGroup 배열을 반환한다.
 *
 * 규칙:
 * - 키는 Math.round(costPrice)|Math.round(retailPrice) — float equality 회피
 * - null costPrice 또는 retailPrice 는 독립 그룹으로 분리 (priceUndefined=true)
 * - 입력 순서를 그룹 및 optionIds 내에서 유지
 */
export function groupOptionsByPrice(options: OptionInput[]): PriceGroup[] {
  // key → { group building state } 순서 보존 맵
  const groupMap = new Map<
    string,
    {
      key: string
      costPrice: number | null
      retailPrice: number | null
      priceUndefined: boolean
      members: OptionInput[]
    }
  >()

  for (const opt of options) {
    const key = makeKey(opt.costPrice, opt.retailPrice)
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        costPrice: opt.costPrice,
        retailPrice: opt.retailPrice,
        priceUndefined: opt.costPrice === null || opt.retailPrice === null,
        members: [],
      })
    }
    groupMap.get(key)!.members.push(opt)
  }

  const result: PriceGroup[] = []
  for (const entry of groupMap.values()) {
    const sharedAttrs = findSharedAttributes(entry.members)
    const sharedLabel = makeSharedLabel(entry.retailPrice, entry.priceUndefined, sharedAttrs)
    result.push({
      key: entry.key,
      costPrice: entry.costPrice,
      retailPrice: entry.retailPrice,
      sharedLabel,
      optionIds: entry.members.map((m) => m.optionId),
      representativeOptionId: entry.members[0].optionId,
      priceUndefined: entry.priceUndefined,
    })
  }

  return result
}
