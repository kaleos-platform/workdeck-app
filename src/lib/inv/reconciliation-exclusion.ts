// 재고 대조 제외 — 판매중지 등으로 관리하지 않는 외부 SKU 를 미매칭에서 빼낸다.
//
// 제외는 파일 수량이 0 인 동안만 유효하다. 수량이 생기면(반품 입고·판매 재개) 다시
// 미매칭으로 드러내고 excludedWithStock 으로 표시한다 — 외부 창고에 실재고가 있는데
// 조용히 묻히면 안 된다. 매핑이 생긴 코드는 matched-* 가 되므로 여기까지 오지 않는다.
//
// 매칭(새 대조)과 상세 GET(저장된 스냅샷 재해석)이 같은 규칙을 쓴다 — 제외/해제가
// 열린 대조 화면에 즉시 반영돼야 한다.
import { prisma } from '@/lib/prisma'
import type { MatchEntry } from './reconciliation-matcher'

export async function applyExclusions(
  entries: MatchEntry[],
  reconLocationId: string
): Promise<MatchEntry[]> {
  const codesByLoc = new Map<string, Set<string>>()
  for (const e of entries) {
    if ((e.status !== 'file-only' && e.status !== 'excluded') || !e.row.externalCode) continue
    const locId = e.locationId ?? reconLocationId
    const s = codesByLoc.get(locId) ?? new Set()
    s.add(e.row.externalCode)
    codesByLoc.set(locId, s)
  }
  if (codesByLoc.size === 0) return entries

  const excluded = new Set<string>() // `${locId}|${code}`
  for (const [locId, codes] of codesByLoc) {
    const rows = await prisma.invReconExcludedCode.findMany({
      where: { locationId: locId, externalCode: { in: Array.from(codes) } },
      select: { externalCode: true },
    })
    for (const r of rows) excluded.add(`${locId}|${r.externalCode}`)
  }

  return entries.map((e): MatchEntry => {
    if ((e.status !== 'file-only' && e.status !== 'excluded') || !e.row.externalCode) return e
    const locationId = e.locationId ?? reconLocationId
    const isExcluded = excluded.has(`${locationId}|${e.row.externalCode}`)
    const suggestions = e.suggestions ?? []
    if (isExcluded && e.row.quantity === 0) {
      return { status: 'excluded', row: e.row, locationId, suggestions }
    }
    return isExcluded
      ? { status: 'file-only', row: e.row, locationId, suggestions, excludedWithStock: true }
      : { status: 'file-only', row: e.row, locationId, suggestions }
  })
}
