/**
 * 현금흐름 상세 테이블 그룹핑(순수 함수) — 리프 행을 3모드로 묶는다.
 *  - group     : 대분류(parentId)별 합계 1행.
 *  - hierarchy : 대분류 헤더 + 하위 리프.
 *  - leaf      : 리프만, 수입=매출/기타 · 지출=고정/변동/미지정 서브그룹.
 * totals(방향 기준)와 정합: 각 모드의 그룹 합계 총합 == 섹션 total.
 * 브라우저 의존 없음 → 유닛 테스트 대상.
 */
import type { FinFlowRole } from '@/generated/prisma/enums'

export type DisplayMode = 'group' | 'hierarchy' | 'leaf'

export interface CashflowLeaf {
  key: string
  name: string
  type: 'INCOME' | 'EXPENSE'
  groupLabel: string | null
  parentId: string | null
  parentName: string
  flowRole: FinFlowRole | null
  values: Record<string, number>
  changePct: number | null
}

export interface CashflowGroup {
  key: string
  label: string
  /** 대분류 그룹일 때 상위 flowRole(색·뱃지용). 서브그룹 모드에선 null. */
  flowRole: FinFlowRole | null
  values: Record<string, number>
  changePct: number | null
  leaves: CashflowLeaf[]
}

const sumOf = (r: { values: Record<string, number> }, buckets: string[]): number =>
  buckets.reduce((a, b) => a + (r.values[b] ?? 0), 0)

/** 버킷별 합계 맵. 소수 오차 방지 위해 반올림. */
function sumValues(leaves: CashflowLeaf[], buckets: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of buckets) {
    const s = leaves.reduce((a, l) => a + (l.values[b] ?? 0), 0)
    out[b] = Math.round(s * 100) / 100
  }
  return out
}

/** 마지막 vs 직전 버킷 증감%(라우트와 동일 규칙, prev 0이면 null). */
function changePctOf(values: Record<string, number>, buckets: string[]): number | null {
  if (buckets.length < 2) return null
  const last = values[buckets[buckets.length - 1]] ?? 0
  const prev = values[buckets[buckets.length - 2]] ?? 0
  if (prev === 0) return null
  return Math.round(((last - prev) / Math.abs(prev)) * 100 * 100) / 100
}

/** leaf 모드 서브그룹 키: 수입=매출/기타, 지출=고정/변동/미지정. */
function subGroupKey(leaf: CashflowLeaf): string {
  if (leaf.type === 'INCOME') return leaf.flowRole === 'MERCH_SALES' ? '매출' : '기타'
  if (leaf.groupLabel === '고정') return '고정'
  if (leaf.groupLabel === '변동') return '변동'
  return '미지정'
}

// leaf 모드 서브그룹 표시 순서(고정순).
const LEAF_ORDER: Record<'INCOME' | 'EXPENSE', string[]> = {
  INCOME: ['매출', '기타'],
  EXPENSE: ['고정', '변동', '미지정'],
}

/**
 * 한 섹션(수입 또는 지출)의 리프 행들을 모드별 그룹으로 변환.
 * rows는 모두 같은 type이라고 가정(라우트가 섹션별로 분리해 내려줌).
 */
export function buildCashflowGroups(
  rows: CashflowLeaf[],
  buckets: string[],
  mode: DisplayMode
): CashflowGroup[] {
  if (rows.length === 0) return []
  const type = rows[0].type

  if (mode === 'leaf') {
    // 서브그룹(매출/기타 · 고정/변동/미지정)별로 묶어 고정 순서로 반환.
    const byKey = new Map<string, CashflowLeaf[]>()
    for (const r of rows) {
      const k = subGroupKey(r)
      const arr = byKey.get(k)
      if (arr) arr.push(r)
      else byKey.set(k, [r])
    }
    const groups: CashflowGroup[] = []
    for (const label of LEAF_ORDER[type]) {
      const leaves = byKey.get(label)
      if (!leaves || leaves.length === 0) continue
      leaves.sort((a, b) => sumOf(b, buckets) - sumOf(a, buckets))
      const values = sumValues(leaves, buckets)
      groups.push({ key: `sub:${type}:${label}`, label, flowRole: null, values, changePct: changePctOf(values, buckets), leaves })
    }
    return groups
  }

  // group / hierarchy: 대분류(parentId)별로 묶음. 미분류(parentId null)는 자체 그룹.
  const byParent = new Map<string, CashflowLeaf[]>()
  for (const r of rows) {
    const k = r.parentId ?? '__none'
    const arr = byParent.get(k)
    if (arr) arr.push(r)
    else byParent.set(k, [r])
  }
  const groups: CashflowGroup[] = []
  for (const [, leaves] of byParent) {
    leaves.sort((a, b) => sumOf(b, buckets) - sumOf(a, buckets))
    const head = leaves[0]
    const values = sumValues(leaves, buckets)
    groups.push({
      key: `grp:${type}:${head.parentId ?? '__none'}`,
      label: head.parentName,
      flowRole: head.flowRole,
      values,
      changePct: changePctOf(values, buckets),
      leaves,
    })
  }
  // 합계 내림차순.
  groups.sort((a, b) => sumOf(b, buckets) - sumOf(a, buckets))
  return groups
}
