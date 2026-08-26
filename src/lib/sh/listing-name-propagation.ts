/**
 * 채널상품(ChannelProduct) base 상품명 → 자식 ProductListing 이름 전파 계산 로직.
 * 원래 group-base-info-card.tsx(클라이언트 컴포넌트)에 있던 순수 함수들을 서버 라우트에서도
 * 재사용할 수 있도록 추출한 파일이다. hooks/DOM/fetch/prisma import 금지 — 순수 계산만 담는다.
 */

export type GroupListingForBase = {
  id: string
  searchName: string
  displayName: string
  managementName: string | null
  internalCode: string | null
  memo: string | null
  items: Array<{
    optionId: string
    attributeValues: Record<string, string>
  }>
}

export type OptionAttribute = { name: string; values: Array<{ value: string }> }

export function buildSuffix(listing: GroupListingForBase, attrs: OptionAttribute[]): string {
  if (listing.items.length === 0) return ''
  // 모든 item이 공통으로 가지는 속성값만 suffix로 사용 (묶음 item일 때 안전).
  // 단, 공통값이라도 listing 이름 끝에 실제로 들어가지 않을 수 있으므로 후처리는 stripSuffix에서.
  const parts: string[] = []
  for (const a of attrs) {
    const first = listing.items[0].attributeValues?.[a.name]
    if (!first) continue
    const allSame = listing.items.every((it) => (it.attributeValues ?? {})[a.name] === first)
    if (allSame) parts.push(first)
  }
  return parts.join(' ')
}

export function joinName(base: string, suffix: string): string {
  if (!base) return suffix
  if (!suffix) return base
  return `${base} ${suffix}`
}

function stripSuffix(value: string | null, suffix: string): string {
  if (!value) return ''
  // 끝의 묶음 라벨(` #N ...`)과 ` N개` 차원을 먼저 제거
  let v = value.replace(/\s+#\d+\s.*$/, '').replace(/\s+\d+개$/, '')
  if (suffix && v.endsWith(suffix)) {
    v = v.slice(0, v.length - suffix.length).trimEnd()
  }
  return v
}

export function deriveBaseValues(
  listings: GroupListingForBase[],
  attrs: OptionAttribute[]
): {
  baseSearchName: string
  baseDisplayName: string
  baseManagementName: string
  baseInternalCode: string
  memo: string
  inconsistentBases: string[]
} {
  const searchBases: string[] = []
  const displayBases: string[] = []
  const managementBases: string[] = []
  const codeBases: string[] = []
  for (const l of listings) {
    const suffix = buildSuffix(l, attrs)
    searchBases.push(stripSuffix(l.searchName, suffix))
    displayBases.push(stripSuffix(l.displayName, suffix))
    managementBases.push(stripSuffix(l.managementName, suffix))
    codeBases.push(stripSuffix(l.internalCode, suffix))
  }

  const inconsistent: string[] = []
  const baseSearchName = mostCommon(searchBases)
  if (new Set(searchBases.filter((s) => s)).size > 1) inconsistent.push('검색명')
  const rawBaseDisplayName = mostCommon(displayBases)
  const sameAsSearchForAll = listings.every((_, idx) => displayBases[idx] === searchBases[idx])
  if (new Set(displayBases.filter((s) => s)).size > 1) inconsistent.push('노출명')
  const baseDisplayName = sameAsSearchForAll ? '' : rawBaseDisplayName
  const baseManagementName = mostCommon(managementBases)
  if (new Set(managementBases.filter((s) => s)).size > 1) inconsistent.push('관리명')
  const baseInternalCode = mostCommon(codeBases)
  if (new Set(codeBases.filter((s) => s)).size > 1) inconsistent.push('관리 코드')

  const memos = listings.map((l) => l.memo ?? '')
  const memo = mostCommon(memos)

  return {
    baseSearchName,
    baseDisplayName,
    baseManagementName,
    baseInternalCode,
    memo,
    inconsistentBases: inconsistent,
  }
}

function mostCommon(values: string[]): string {
  if (values.length === 0) return ''
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = values[0]
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v.length > best.length)) {
      best = v
      bestCount = c
    }
  }
  return best
}

/**
 * 그룹 상세 "기본 정보" 카드에서 base 상품명(검색용/노출용)을 수정했을 때,
 * 각 listing 고유의 tail(=기존 base 이후 부분, 옵션 접미어)을 보존한 채 새 이름을 재구성한다.
 * group-detail-view.tsx doSave() 안의 인라인 tail() 클로저를 그대로 옮긴 순수 함수 — 동작 무변경.
 */
export function applyBaseRename(
  listing: GroupListingForBase,
  attrs: OptionAttribute[],
  derived: { baseSearchName: string; baseDisplayName: string },
  next: { searchName: string; displayName: string }
): { searchName: string; displayName: string } {
  const tail = (name: string | null, oldBase: string): string => {
    if (!name) return ''
    if (oldBase && name.startsWith(oldBase)) return name.slice(oldBase.length)
    // base가 매칭 안 되는 경우 attribute suffix로 회복
    const suffix = buildSuffix(listing, attrs)
    return suffix ? ` ${suffix}` : ''
  }

  const newSearch = (
    next.searchName.trim() + tail(listing.searchName, derived.baseSearchName)
  ).trim()
  const searchName = newSearch || listing.searchName

  const newDisplay = (
    (next.displayName.trim() || next.searchName.trim()) +
    tail(listing.displayName, derived.baseDisplayName || derived.baseSearchName)
  ).trim()
  const displayName = newDisplay || listing.displayName

  return { searchName, displayName }
}
