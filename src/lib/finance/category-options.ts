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
  /** 비활성 항목은 새 분류 선택지에서 숨긴다(미지정=활성 취급). */
  isActive?: boolean
  children: CategoryTreeNode[]
}

export type ComboOption = {
  id: string
  /** 표시 1차(잎/계정 이름) */
  label: string
  /** 하위면 상위명(breadcrumb), 상위면 null */
  hint?: string | null
  /** 루트 계정과목 타입(수익/비용/이체 탭 필터 키). 미지정=탭 미적용. */
  type?: FinCategoryType
  /** 상위에 표시할 그룹(수익/비용/이체) 배지 */
  badge?: { label: string; className: string } | null
  /** 하위 들여쓰기 여부 */
  indent?: boolean
  /**
   * 비활성 여부(false면 비활성). 빌더는 비활성 항목도 포함하되 이 플래그로 표시하고,
   * 콤보박스가 목록에서 숨긴다(현재 선택값은 라벨 보존 위해 유지). 미지정=활성.
   */
  isActive?: boolean
  /** 검색 매칭 키워드: [이름, 상위명, 그룹명] */
  keywords: string[]
}

const CLASSIFY_TYPES: FinCategoryType[] = ['INCOME', 'EXPENSE', 'TRANSFER']

/**
 * 분류 대상(잎) 옵션 — 운영 항목(리프)만 선택 가능하게 한다.
 * 운영 차트는 2단계(대분류 → 운영 항목). INCOME/EXPENSE의 lvl1은 그룹 헤더 역할이라
 * 분류 타깃이 아니며 하위 운영 항목만 옵션으로 내보낸다(대분류명은 breadcrumb hint).
 * 빈 대분류는 내보낼 리프가 없어 타깃에서 제외된다(자식 유무가 아니라 루트 타입으로 판별).
 * TRANSFER는 lvl1이 곧 리프(이체 항목)라 그 자체를 분류 타깃으로 내보낸다.
 * 규칙 대상처럼 수익/비용만 필요하면 types로 제한.
 *
 * 비활성 항목도 isActive=false로 표시해 포함한다(콤보박스가 새 선택지에선 숨기되 현재
 * 선택값 라벨은 보존). 비활성 대분류는 하위 리프 전체를 비활성으로 전파한다.
 */
export function buildClassifyOptions(
  tree: CategoryTreeNode[],
  types: FinCategoryType[] = CLASSIFY_TYPES
): ComboOption[] {
  const allow = new Set(types)
  const out: ComboOption[] = []
  for (const root of tree) {
    if (!allow.has(root.type as FinCategoryType)) continue
    const rootType = root.type as FinCategoryType
    const badge = categoryTypeBadge(rootType)
    // 대분류/리프 구분은 자식 유무가 아니라 루트 타입으로 결정한다.
    // TRANSFER: lvl1이 곧 분류 대상(리프). INCOME/EXPENSE: lvl1은 그룹이라 하위 리프만 타깃이며,
    // 자식 없는 빈 대분류는 분류 타깃이 되어선 안 된다(리프에만 분류하는 모델).
    const lvl1IsLeaf = root.type === 'TRANSFER'
    for (const lvl1 of root.children) {
      if (lvl1IsLeaf) {
        // 이체 항목: 대분류가 곧 분류 대상(리프) — 그대로 옵션.
        out.push({
          id: lvl1.id,
          label: lvl1.name,
          hint: null,
          type: rootType,
          badge: { label: badge.label, className: badge.className },
          indent: false,
          isActive: lvl1.isActive,
          keywords: [lvl1.name, badge.label],
        })
      } else {
        // 대분류는 그룹(선택 불가) — 하위 운영 항목만 분류 타깃으로, 대분류명을 breadcrumb hint로.
        // (빈 대분류는 내보낼 리프가 없어 자연히 타깃에서 제외된다.)
        // 대분류가 비활성이면 하위 리프 전체를 비활성으로 전파.
        const groupActive = lvl1.isActive !== false
        for (const sub of lvl1.children ?? []) {
          out.push({
            id: sub.id,
            label: sub.name,
            hint: lvl1.name,
            type: rootType,
            badge: { label: badge.label, className: badge.className },
            indent: true,
            isActive: groupActive && sub.isActive !== false,
            keywords: [sub.name, lvl1.name, badge.label],
          })
        }
      }
    }
  }
  return out
}

/** 미분류 필터 sentinel id — 거래내역 필터 콤보에서 categoryId null 거래 선택용. */
export const UNCATEGORIZED_OPTION_ID = '__uncategorized__'

/**
 * 거래내역 필터 콤보 옵션 — 분류(buildClassifyOptions)와 달리 **대분류(lvl1)도 선택 가능**하게 하고
 * 맨 앞에 "미분류" sentinel을 넣는다. 대분류 선택 = 그 하위 리프 전체 필터(서버 expandCategory).
 * (분류 경로는 리프에만 배정해야 하므로 buildClassifyOptions는 그대로 두고 별도 빌더로 분리.)
 */
export function buildFilterCategoryOptions(
  tree: CategoryTreeNode[],
  types: FinCategoryType[] = CLASSIFY_TYPES
): ComboOption[] {
  const allow = new Set(types)
  const out: ComboOption[] = [
    {
      id: UNCATEGORIZED_OPTION_ID,
      label: '미분류',
      hint: null,
      badge: null,
      indent: false,
      keywords: ['미분류', '미지정'],
    },
  ]
  for (const root of tree) {
    if (!allow.has(root.type as FinCategoryType)) continue
    const rootType = root.type as FinCategoryType
    const badge = categoryTypeBadge(rootType)
    const lvl1IsLeaf = root.type === 'TRANSFER'
    for (const lvl1 of root.children) {
      if (lvl1IsLeaf) {
        out.push({
          id: lvl1.id,
          label: lvl1.name,
          hint: null,
          type: rootType,
          badge: { label: badge.label, className: badge.className },
          indent: false,
          isActive: lvl1.isActive,
          keywords: [lvl1.name, badge.label],
        })
        continue
      }
      // 대분류(lvl1) 자체를 선택 가능 옵션으로(그룹 전체 필터) — indent=false.
      const groupActive = lvl1.isActive !== false
      out.push({
        id: lvl1.id,
        label: lvl1.name,
        hint: null,
        type: rootType,
        badge: { label: badge.label, className: badge.className },
        indent: false,
        isActive: groupActive,
        keywords: [lvl1.name, badge.label],
      })
      // 하위 리프.
      for (const sub of lvl1.children ?? []) {
        out.push({
          id: sub.id,
          label: sub.name,
          hint: lvl1.name,
          type: rootType,
          badge: { label: badge.label, className: badge.className },
          indent: true,
          isActive: groupActive && sub.isActive !== false,
          keywords: [sub.name, lvl1.name, badge.label],
        })
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
    const rootType = root.type as FinCategoryType
    const badge = categoryTypeBadge(rootType)
    out.push({
      id: root.id,
      label: root.name,
      hint: null,
      type: rootType,
      badge: { label: badge.label, className: badge.className },
      indent: false,
      keywords: [root.name, badge.label],
    })
    for (const lvl1 of root.children) {
      out.push({
        id: lvl1.id,
        label: lvl1.name,
        hint: root.name,
        type: rootType,
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
