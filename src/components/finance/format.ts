/**
 * 재무 관리 Deck — 프론트 공용 포맷 유틸 + 상태/타입 배지 클래스.
 * DESIGN.md §3.2 상태색(라이트/다크 쌍) + 고정폭 수치(JetBrains Mono) 관례를 따른다.
 */
import type { FinCategoryType, FinClassStatus, FinAccountKind } from '@/generated/prisma/enums'

/** 원화 포맷: ₩1,234,567 (소수 없음, 음수 앞 부호). */
export function formatWon(n: number | null | undefined): string {
  if (n == null) return '-'
  const sign = n < 0 ? '-' : ''
  return `${sign}₩${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`
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
