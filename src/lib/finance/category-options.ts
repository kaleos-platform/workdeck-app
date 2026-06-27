/**
 * 재무 계정과목 선택기(콤보박스) 공유 옵션 빌더.
 * 분류 대상(잎) 옵션과 추가 팝업의 상위 선택 옵션을 단일 소스로 생성한다.
 * (기존 transactions-view/accounts-manager의 중복 flattenLeafTargets/collectParentOptions 대체.)
 */
import type { FinCategoryType } from '@/generated/prisma/enums'
import { categoryTypeBadge } from '@/components/finance/format'

/** 트리 노드 최소 형태(상위/하위 2단계). */
export type CategoryTreeNode = {
  id: string
  name: string
  type: string
  children: CategoryTreeNode[]
}

export type ComboOption = {
  id: string
  /** 표시 1차(잎/계정 이름) */
  label: string
  /** 하위면 상위명(breadcrumb), 상위면 null */
  hint?: string | null
  /** 상위에 표시할 그룹(수익/비용/이체) 배지 */
  badge?: { label: string; className: string } | null
  /** 하위 들여쓰기 여부 */
  indent?: boolean
  /** 검색 매칭 키워드: [이름, 상위명, 그룹명] */
  keywords: string[]
}

const CLASSIFY_TYPES: FinCategoryType[] = ['INCOME', 'EXPENSE', 'TRANSFER']

/**
 * 분류 대상(잎) 옵션 — 운영 항목(리프)만 선택 가능하게 한다.
 * 운영 차트는 2단계(대분류 → 운영 항목). 대분류(lvl1, 자식 있음)는 그룹 헤더 역할이라
 * 분류 타깃이 아니며 하위 운영 항목만 옵션으로 내보낸다(대분류명은 breadcrumb hint).
 * 대분류가 곧 리프인 경우(예: 이체 항목)는 그 자체를 분류 타깃으로 내보낸다.
 * 규칙 대상처럼 수익/비용만 필요하면 types로 제한.
 */
export function buildClassifyOptions(
  tree: CategoryTreeNode[],
  types: FinCategoryType[] = CLASSIFY_TYPES
): ComboOption[] {
  const allow = new Set(types)
  const out: ComboOption[] = []
  for (const root of tree) {
    if (!allow.has(root.type as FinCategoryType)) continue
    const badge = categoryTypeBadge(root.type as FinCategoryType)
    for (const lvl1 of root.children) {
      const leaves = lvl1.children ?? []
      if (leaves.length === 0) {
        // 대분류가 곧 분류 대상(리프) — 그대로 옵션.
        out.push({
          id: lvl1.id,
          label: lvl1.name,
          hint: null,
          badge: { label: badge.label, className: badge.className },
          indent: false,
          keywords: [lvl1.name, badge.label],
        })
      } else {
        // 대분류는 그룹(선택 불가) — 하위 운영 항목만 분류 타깃으로, 대분류명을 breadcrumb hint로.
        for (const sub of leaves) {
          out.push({
            id: sub.id,
            label: sub.name,
            hint: lvl1.name,
            badge: { label: badge.label, className: badge.className },
            indent: true,
            keywords: [sub.name, lvl1.name, badge.label],
          })
        }
      }
    }
  }
  return out
}

/** 추가 팝업 상위 선택 옵션: root(수익/비용/이체) + lvl1(상위 breadcrumb). */
export function buildParentOptions(tree: CategoryTreeNode[]): ComboOption[] {
  const allow = new Set(CLASSIFY_TYPES)
  const out: ComboOption[] = []
  for (const root of tree) {
    if (!allow.has(root.type as FinCategoryType)) continue
    const badge = categoryTypeBadge(root.type as FinCategoryType)
    out.push({
      id: root.id,
      label: root.name,
      hint: null,
      badge: { label: badge.label, className: badge.className },
      indent: false,
      keywords: [root.name, badge.label],
    })
    for (const lvl1 of root.children) {
      out.push({
        id: lvl1.id,
        label: lvl1.name,
        hint: root.name,
        badge: null,
        indent: true,
        keywords: [lvl1.name, root.name],
      })
    }
  }
  return out
}

/** 선택된 id의 트리거 표시 라벨(하위면 `상위 › 이름`). */
export function comboOptionLabel(options: ComboOption[], id: string | null): string {
  if (!id) return ''
  const opt = options.find((o) => o.id === id)
  if (!opt) return ''
  return opt.hint ? `${opt.hint} › ${opt.label}` : opt.label
}
