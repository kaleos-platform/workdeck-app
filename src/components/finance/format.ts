/**
 * 재무 관리 Deck — 프론트 공용 포맷 유틸 + 상태/타입 배지 클래스.
 * DESIGN.md §3.2 상태색(라이트/다크 쌍) + 고정폭 수치(JetBrains Mono) 관례를 따른다.
 */
import type {
  FinCategoryType,
  FinClassStatus,
  FinAccountKind,
  FinFlowRole,
} from '@/generated/prisma/enums'

/** 원화 포맷: ₩1,234,567 (소수 없음, 음수 앞 부호). */
export function formatWon(n: number | null | undefined): string {
  if (n == null) return '-'
  const sign = n < 0 ? '-' : ''
  return `${sign}₩${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`
}

/**
 * 축약 원화(흐름도 라벨용): ₩1.08억 / ₩6,720만 / ₩720.
 * ≥1억 → 억(소수 2자리), ≥1만 → 만(정수), 그 외 정수. 음수 앞 부호.
 */
export function formatWonShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 100_000_000) {
    return `${sign}₩${(abs / 100_000_000).toFixed(2)}억`
  }
  if (abs >= 10_000) {
    return `${sign}₩${Math.round(abs / 10_000).toLocaleString('ko-KR')}만`
  }
  return `${sign}₩${Math.round(abs).toLocaleString('ko-KR')}`
}

/** 부호 강조 포맷(증감용): +₩1,234 / -₩1,234. */
export function formatSignedWon(n: number | null | undefined): string {
  if (n == null) return '-'
  if (n === 0) return '₩0'
  return `${n > 0 ? '+' : '-'}₩${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`
}

/** 퍼센트: 12.3% (소수 1자리, 부호 옵션). */
export function formatPercent(n: number | null | undefined, opts?: { sign?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return '-'
  const s = opts?.sign && n > 0 ? '+' : ''
  return `${s}${n.toFixed(1)}%`
}

/** 전기 대비 증감률(%) — prev 0이면 null. */
export function deltaPercent(cur: number, prev: number): number | null {
  if (prev === 0) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

/** 계좌번호 마스킹 표시(이미 마스킹된 값은 그대로). */
export function maskAccountNumber(num: string | null | undefined): string {
  if (!num) return ''
  return num
}

// ─── 손익 흐름도 역할(flowRole) 라벨·안내 ─────────────────────────────────────
// 대분류에 부여하는 손익 분류. 수입: MERCH_SALES=매출 / null=기타.
// 지출: COGS=매출원가 / OPEX=영업비용 / FINANCING_COST=금융비용 / null=미지정.

/** flowRole → 짧은 라벨(대분류 type에 따라 null 라벨이 달라짐). */
export function flowRoleLabel(
  role: FinFlowRole | null,
  type: 'INCOME' | 'EXPENSE'
): string {
  switch (role) {
    case 'MERCH_SALES':
      return '매출'
    case 'COGS':
      return '매출원가'
    case 'OPEX':
      return '영업비용'
    case 'FINANCING_COST':
      return '금융비용'
    default:
      return type === 'INCOME' ? '기타' : '미지정'
  }
}

/** flowRole 뱃지: 라벨 + 색 클래스(라이트/다크). 매출=emerald 강조, 비용류=색상, 미지정/기타=neutral. */
export function flowRoleBadge(
  role: FinFlowRole | null,
  type: 'INCOME' | 'EXPENSE'
): { label: string; className: string } {
  const label = flowRoleLabel(role, type)
  const neutral = 'bg-muted text-muted-foreground border-border'
  switch (role) {
    case 'MERCH_SALES':
      return {
        label,
        className:
          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400',
      }
    case 'COGS':
      return {
        label,
        className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400',
      }
    case 'OPEX':
      return {
        label,
        className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-400',
      }
    case 'FINANCING_COST':
      return {
        label,
        className:
          'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400',
      }
    default:
      return { label, className: neutral }
  }
}

/** 분류 안내(툴팁) — "어떤 항목을 넣는지". 수입 기타는 OTHER_INCOME 키로 참조. */
export const FLOW_ROLE_GUIDE: Record<string, string> = {
  MERCH_SALES: '상품·서비스 판매 등 주된 영업 수익. 흐름도 매출총이익(매출 − 매출원가) 계산의 기준입니다.',
  OTHER_INCOME: '매출 외 수입 — 정부지원금·이자수익·잡수입 등.',
  COGS: '판매한 상품의 매입·제조 원가. 매출에서 차감해 매출총이익을 산출합니다.',
  OPEX: '판매·관리 활동 비용 — 인건비·마케팅·물류·임차료·수수료 등.',
  FINANCING_COST: '차입금 이자 등 재무 비용. 영업이익에서 차감해 순현금흐름을 산출합니다.',
}

/** 원가 성격(고정/변동) 안내(툴팁). */
export const COST_NATURE_GUIDE: Record<'고정' | '변동', string> = {
  고정: '매출과 무관하게 매월 일정하게 발생 — 임차료·급여·구독료 등.',
  변동: '매출·판매량에 비례해 증감 — 상품 매입·택배비·결제수수료 등.',
}

// ─── 상태/타입 배지 클래스 (DESIGN.md §3.2) ─────────────────────────────────────

/** 계정과목 type 배지: 자산=blue, 부채=red, 수익=emerald, 비용=amber, 자본/이체=neutral. */
export function categoryTypeBadge(type: FinCategoryType): { label: string; className: string } {
  switch (type) {
    case 'ASSET':
      return {
        label: '자산',
        className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900 dark:text-blue-400',
      }
    case 'LIABILITY':
      return {
        label: '부채',
        className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900 dark:text-red-400',
      }
    case 'INCOME':
      return {
        label: '수익',
        className:
          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900 dark:text-emerald-400',
      }
    case 'EXPENSE':
      return {
        label: '비용',
        className:
          'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400',
      }
    case 'EQUITY':
      return {
        label: '자본',
        className: 'bg-muted text-muted-foreground border-border',
      }
    case 'TRANSFER':
    default:
      return {
        label: '이체',
        className: 'bg-muted text-muted-foreground border-border',
      }
  }
}

/** 분류 상태 배지: 자동분류=emerald, 검토=amber, 미분류=neutral. */
export function classStatusBadge(status: FinClassStatus): { label: string; className: string } {
  switch (status) {
    case 'CLASSIFIED':
      return {
        label: '분류완료',
        className:
          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900 dark:text-emerald-400',
      }
    case 'REVIEW':
      return {
        label: '검토 필요',
        className:
          'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400',
      }
    case 'UNCLASSIFIED':
    default:
      return {
        label: '미분류',
        className: 'bg-muted text-muted-foreground border-border',
      }
  }
}

/** 출처 칩: 은행 / 카드. */
export function accountKindLabel(kind: FinAccountKind): string {
  return kind === 'CARD' ? '카드' : '은행'
}
