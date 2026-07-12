'use client'

/**
 * 계좌/카드 × 월 데이터 등록 커버리지 매트릭스.
 * 셀 판정: 확정 거래 있음=등록됨(건수), DRAFT 스테이징만=검토중, 둘 다 없음=미등록.
 * 업로드 페이지(요약)와 등록 이력 페이지(상세)에서 공용.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CreditCard, Landmark, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { FINANCE_IMPORTS_PATH } from '@/lib/deck-routes'

type CoverageCell = { confirmed: number; staged: number }

type CoverageAccount = {
  id: string
  name: string
  kind: string
  institution: string | null
  accountNumber: string | null
  lastImportAt: string | null
  cells: Record<string, CoverageCell>
}

type CoverageResponse = {
  months: string[]
  accounts: CoverageAccount[]
}

type CoverageMatrixProps = {
  /** 표시 개월 수 (기본 12) */
  months?: number
  /** 특정 계좌만 표시 */
  accountId?: string
  /** 값이 바뀌면 재조회 — 업로드 완료 후 갱신용 */
  refreshToken?: number
  /** 셀/행 클릭 시 이동 대신 커스텀 동작 */
  onCellClick?: (accountId: string, month: string) => void
  className?: string
}

export function CoverageMatrix({
  months = 12,
  accountId,
  refreshToken,
  onCellClick,
  className,
}: CoverageMatrixProps) {
  const [data, setData] = useState<CoverageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ months: String(months) })
      if (accountId) params.set('accountId', accountId)
      const res = await fetch(`/api/finance/coverage?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? '커버리지 조회 실패')
      }
      setData((await res.json()) as CoverageResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : '커버리지 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [months, accountId])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  if (loading && !data) {
    return (
      <div className={cn('flex items-center gap-2 py-6 text-sm text-muted-foreground', className)}>
        <Loader2 className="size-4 animate-spin" />
        커버리지 불러오는 중...
      </div>
    )
  }
  if (error) {
    return <p className={cn('py-4 text-sm text-destructive', className)}>{error}</p>
  }
  if (!data || data.accounts.length === 0) {
    return (
      <p className={cn('py-4 text-sm text-muted-foreground', className)}>
        등록된 계좌/카드가 없습니다 — 파일을 업로드하면 계좌를 등록할 수 있습니다
      </p>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground backdrop-blur">
                계좌/카드
              </th>
              {data.months.map((m) => (
                <th
                  key={m}
                  className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap text-muted-foreground"
                >
                  {Number(m.slice(5, 7))}월
                  {m.endsWith('-01') || m === data.months[0] ? (
                    <span className="block text-[10px] font-normal opacity-70">
                      {m.slice(0, 4)}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((acct) => (
              <tr key={acct.id} className="border-b last:border-b-0">
                <td className="sticky left-0 z-10 bg-background px-3 py-2 whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    {acct.kind === 'CARD' ? (
                      <CreditCard className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Landmark className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="max-w-40 truncate text-xs font-medium">
                      {[acct.institution, acct.name].filter(Boolean).join(' ')}
                    </span>
                  </span>
                </td>
                {data.months.map((m) => {
                  const cell = acct.cells[m]
                  const confirmed = cell?.confirmed ?? 0
                  const staged = cell?.staged ?? 0
                  const state = confirmed > 0 ? 'confirmed' : staged > 0 ? 'staged' : 'empty'
                  const label =
                    state === 'confirmed'
                      ? `확정 ${confirmed}건${staged > 0 ? ` · 검토중 ${staged}건` : ''}`
                      : state === 'staged'
                        ? `검토중 ${staged}건 — 거래내역에서 저장 처리 필요`
                        : '미등록'
                  const inner = (
                    <span
                      title={`${m} · ${label}`}
                      className={cn(
                        'mx-auto flex h-7 min-w-9 items-center justify-center rounded px-1 text-xs font-medium',
                        state === 'confirmed' &&
                          'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
                        state === 'staged' &&
                          'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
                        state === 'empty' && 'text-muted-foreground/40'
                      )}
                    >
                      {state === 'confirmed' ? confirmed : state === 'staged' ? '검토' : '–'}
                      {state === 'confirmed' && staged > 0 && (
                        <span className="ml-0.5 size-1.5 rounded-full bg-amber-500" />
                      )}
                    </span>
                  )
                  return (
                    <td key={m} className="px-1 py-1.5 text-center">
                      {onCellClick ? (
                        <button
                          type="button"
                          className="w-full cursor-pointer"
                          onClick={() => onCellClick(acct.id, m)}
                        >
                          {inner}
                        </button>
                      ) : (
                        <Link href={`${FINANCE_IMPORTS_PATH}?accountId=${acct.id}`}>{inner}</Link>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded bg-emerald-100 dark:bg-emerald-950" />
          등록됨(확정 건수)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded bg-amber-100 dark:bg-amber-950" />
          검토중(미저장)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded border" />
          미등록
        </span>
      </div>
    </div>
  )
}
