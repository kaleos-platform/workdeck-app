'use client'

/**
 * 데이터 등록 이력 — 커버리지 매트릭스 + 업로드 파일(FinImport) 목록.
 * ?accountId= 쿼리로 특정 계좌 필터 진입(계좌 관리·매트릭스 셀에서 링크).
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CreditCard, Landmark, Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CoverageMatrix } from '@/components/finance/coverage-matrix'
import { FINANCE_TRANSACTIONS_PATH, FINANCE_UPLOAD_PATH } from '@/lib/deck-routes'

const ALL_ACCOUNTS = '__all__'
const PAGE_SIZE = 50

type ImportRow = {
  id: string
  fileName: string
  institution: string
  kind: string
  status: 'DRAFT' | 'COMMITTED'
  periodFrom: string | null
  periodTo: string | null
  totalRows: number
  committedRows: number
  createdAt: string
  account: { id: string; name: string; kind: string; institution: string | null }
}

type AccountOption = { id: string; name: string; kind: string; institution: string | null }

/** txnDate 저장 규약(KST 자릿수의 UTC 저장) — 날짜는 UTC getter로 읽는다 */
function formatYmd(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

export function ImportsView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const accountId = searchParams.get('accountId') ?? ''

  const [rows, setRows] = useState<ImportRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountOption[]>([])

  // 계좌 필터 옵션 로드(1회)
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/finance/accounts')
        if (!res.ok) return
        const data = await res.json()
        const list = (data?.accounts ?? data ?? []) as AccountOption[]
        if (Array.isArray(list)) setAccounts(list)
      } catch {
        // 필터 옵션 실패는 치명적이지 않음 — 목록은 계속 표시
      }
    })()
  }, [])

  const load = useCallback(
    async (nextOffset: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) })
        if (accountId) params.set('accountId', accountId)
        const res = await fetch(`/api/finance/imports?${params}`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.message ?? '등록 이력 조회 실패')
        }
        const data = (await res.json()) as { total: number; imports: ImportRow[] }
        setRows(data.imports)
        setTotal(data.total)
        setOffset(nextOffset)
      } catch (err) {
        setError(err instanceof Error ? err.message : '등록 이력 조회 실패')
      } finally {
        setLoading(false)
      }
    },
    [accountId]
  )

  useEffect(() => {
    void load(0)
  }, [load])

  function handleAccountFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === ALL_ACCOUNTS) params.delete('accountId')
    else params.set('accountId', value)
    router.replace(`?${params.toString()}`)
  }

  const selectedAccount = accounts.find((a) => a.id === accountId)

  return (
    <div className="space-y-6">
      {/* 월별 커버리지 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>월별 등록 현황</CardTitle>
            <Button variant="outline" size="sm" onClick={() => router.push(FINANCE_UPLOAD_PATH)}>
              데이터 등록
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CoverageMatrix months={12} accountId={accountId || undefined} />
        </CardContent>
      </Card>

      {/* 업로드 파일 목록 */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              업로드 파일
              <span className="ml-2 text-xs font-normal text-muted-foreground">총 {total}건</span>
            </CardTitle>
            <Select value={accountId || ALL_ACCOUNTS} onValueChange={handleAccountFilter}>
              <SelectTrigger className="h-8 w-56 text-sm">
                <SelectValue placeholder="전체 계좌/카드" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ACCOUNTS}>전체 계좌/카드</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {[a.institution, a.name].filter(Boolean).join(' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedAccount && (
            <p className="text-xs text-muted-foreground">
              {[selectedAccount.institution, selectedAccount.name].filter(Boolean).join(' ')} 필터
              적용 중
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              불러오는 중...
            </div>
          ) : error ? (
            <p className="px-6 py-8 text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground">
              등록 이력이 없습니다 — 데이터 등록에서 파일을 업로드하세요
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">파일명</TableHead>
                  <TableHead className="text-xs">계좌/카드</TableHead>
                  <TableHead className="text-xs">데이터 기간</TableHead>
                  <TableHead className="text-right text-xs">행수(확정/전체)</TableHead>
                  <TableHead className="text-xs">상태</TableHead>
                  <TableHead className="text-xs">등록일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`${FINANCE_TRANSACTIONS_PATH}?importId=${row.id}`)}
                  >
                    <TableCell
                      className="max-w-64 truncate text-xs font-medium"
                      title={row.fileName}
                    >
                      {row.fileName}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        {row.account.kind === 'CARD' ? (
                          <CreditCard className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <Landmark className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {[row.account.institution, row.account.name].filter(Boolean).join(' ')}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {row.periodFrom ? (
                        <>
                          {formatYmd(row.periodFrom)}
                          {row.periodTo && ` ~ ${formatYmd(row.periodTo)}`}
                        </>
                      ) : (
                        '–'
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs whitespace-nowrap">
                      {row.committedRows}/{row.totalRows}
                    </TableCell>
                    <TableCell>
                      {row.status === 'COMMITTED' ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
                        >
                          저장됨
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400"
                        >
                          검토중
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatYmd(row.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {/* 페이지네이션 */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={offset === 0 || loading}
                onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
              >
                이전
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => void load(offset + PAGE_SIZE)}
              >
                다음
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
