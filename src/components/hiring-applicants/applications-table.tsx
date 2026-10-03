'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  FloatingActionBar,
  floatingActionButtonClass,
  floatingActionSelectTriggerClass,
} from '@/components/ui/floating-action-bar'
import { applyRangeSelection } from '@/lib/range-selection'
import { RECRUITING_APPLICATIONS_PATH, getRecruitingApplicationPath } from '@/lib/deck-routes'
import { STAGE_LABELS } from '@/lib/hiring/application-shared'
import { APPLICATION_STAGES } from '@/lib/validations/hiring-applicants'
import type { ApplicationListRow } from '@/lib/hiring/application-shared'
import type { HiringApplicationStage } from '@/generated/prisma/client'
import {
  StageBadge,
  ProcessStageBadge,
  DuplicatedBadge,
  BlacklistBadge,
} from '@/components/hiring-applicants/badges'

type Props = {
  rows: ApplicationListRow[]
  total: number
  pageSize: number
  page: number
  postings: Array<{ id: string; title: string }>
  filters: { posting: string; stage: string; from: string; to: string }
}

const ALL = '__all__'

export function ApplicationsTable({ rows, total, pageSize, page, postings, filters }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState<HiringApplicationStage | ''>('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const lastIndex = useRef<number | null>(null)
  const bulkInFlight = useRef(false)
  const exportInFlight = useRef(false)
  const busy = bulkLoading || pending

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const allKeys = rows.map((r) => r.id)
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k))
  const someSelected = !allSelected && allKeys.some((k) => selected.has(k))

  function updateQuery(patch: Record<string, string>) {
    if (bulkInFlight.current || pending) return
    lastIndex.current = null
    const params = new URLSearchParams()
    const next = { ...filters, page: '1', ...patch }
    if (next.posting) params.set('posting', next.posting)
    if (next.stage) params.set('stage', next.stage)
    if (next.from) params.set('from', next.from)
    if (next.to) params.set('to', next.to)
    if (next.page && next.page !== '1') params.set('page', next.page)
    startTransition(() => {
      router.push(`${RECRUITING_APPLICATIONS_PATH}?${params.toString()}`)
      setSelected(new Set())
    })
  }

  function toggleRow(id: string, index: number, shiftKey: boolean) {
    if (bulkInFlight.current || pending) return
    setSelected((prev) =>
      applyRangeSelection(prev, allKeys, id, index, shiftKey, lastIndex.current)
    )
    lastIndex.current = index
  }

  async function runBulkStage() {
    if (bulkInFlight.current || pending || !bulkStage || selected.size === 0) return
    bulkInFlight.current = true
    setBulkLoading(true)
    try {
      const res = await fetch('/api/hiring-applicants/applications/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), stage: bulkStage }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '일괄 변경 실패')
      }
      const { updated } = await res.json()
      if (!Number.isInteger(updated) || updated < 0 || updated > selected.size) {
        throw new Error('변경 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해 주세요')
      }
      if (updated === selected.size) {
        toast.success(`${updated}건을 '${STAGE_LABELS[bulkStage]}'(으)로 변경했습니다`)
      } else {
        toast.warning(
          `${selected.size}건 중 ${updated}건을 변경했습니다. 나머지는 삭제되었거나 접근할 수 없습니다`
        )
      }
      setSelected(new Set())
      setBulkStage('')
      startTransition(() => router.refresh())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 변경 실패')
    } finally {
      bulkInFlight.current = false
      setBulkLoading(false)
    }
  }

  async function exportExcel() {
    if (exportInFlight.current || busy) return
    exportInFlight.current = true
    setExporting(true)
    const params = new URLSearchParams()
    if (filters.posting) params.set('posting', filters.posting)
    if (filters.stage) params.set('stage', filters.stage)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    try {
      const res = await fetch(`/api/hiring-applicants/applications/export?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '엑셀 내보내기에 실패했습니다')
      }
      if (
        !res.headers
          .get('Content-Type')
          ?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      ) {
        throw new Error('엑셀 파일을 받지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        'applicants.xlsx'
      document.body.appendChild(link)
      try {
        link.click()
      } finally {
        link.remove()
        // 브라우저가 다운로드를 시작할 시간을 준 뒤 메모리를 해제한다.
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '엑셀 내보내기에 실패했습니다')
    } finally {
      exportInFlight.current = false
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* 필터 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Select
            disabled={busy}
            value={filters.posting || ALL}
            onValueChange={(v) => updateQuery({ posting: v === ALL ? '' : v })}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="전체 공고" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체 공고</SelectItem>
              {postings.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            disabled={busy}
            value={filters.stage || ALL}
            onValueChange={(v) => updateQuery({ stage: v === ALL ? '' : v })}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="전체 상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체 상태</SelectItem>
              {APPLICATION_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 text-sm">
            <Input
              type="date"
              disabled={busy}
              value={filters.from}
              onChange={(e) => updateQuery({ from: e.target.value })}
              className="w-36"
            />
            <span className="text-muted-foreground">~</span>
            <Input
              type="date"
              disabled={busy}
              value={filters.to}
              onChange={(e) => updateQuery({ to: e.target.value })}
              className="w-36"
            />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting || busy}>
          {exporting ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <Download className="mr-1 size-4" />
          )}
          엑셀 내보내기
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(allKeys) : new Set())}
                  aria-label="전체 선택"
                  disabled={allKeys.length === 0 || busy}
                />
              </TableHead>
              <TableHead>이름</TableHead>
              <TableHead>공고</TableHead>
              <TableHead>결과</TableHead>
              <TableHead>단계</TableHead>
              <TableHead>표시</TableHead>
              <TableHead className="text-right">지원일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {pending ? (
                    '불러오는 중...'
                  ) : page > totalPages ? (
                    <div className="space-y-2">
                      <p>요청한 페이지에 지원자가 없습니다</p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => updateQuery({ page: '1' })}
                      >
                        첫 페이지로 이동
                      </Button>
                    </div>
                  ) : (
                    '지원자가 없습니다'
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => {
                    if (!busy) router.push(getRecruitingApplicationPath(r.id))
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(r.id)}
                      disabled={busy}
                      onClick={(e: React.MouseEvent) => toggleRow(r.id, i, e.shiftKey)}
                      onCheckedChange={() => {}}
                      aria-label={`${r.maskedName} 선택`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{r.maskedName}</TableCell>
                  <TableCell className="text-sm">
                    <div className="max-w-[220px] truncate" title={r.postingTitle}>
                      {r.postingTitle}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={r.stage} />
                  </TableCell>
                  <TableCell>
                    <ProcessStageBadge stage={r.hiringStage} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.duplicated && <DuplicatedBadge />}
                      {r.blacklisted && <BlacklistBadge />}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>총 {total.toLocaleString('ko-KR')}건</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || busy}
            onClick={() => updateQuery({ page: String(page - 1) })}
          >
            이전
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || busy}
            onClick={() => updateQuery({ page: String(page + 1) })}
          >
            다음
          </Button>
        </div>
      </div>

      <FloatingActionBar
        open={selected.size > 0}
        onClear={() => setSelected(new Set())}
        clearDisabled={busy}
        actions={
          <>
            <Select
              disabled={busy}
              value={bulkStage}
              onValueChange={(v) => setBulkStage(v as HiringApplicationStage)}
            >
              <SelectTrigger className={`w-32 ${floatingActionSelectTriggerClass}`}>
                <SelectValue placeholder="상태 변경" />
              </SelectTrigger>
              <SelectContent>
                {APPLICATION_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonClass}
              onClick={runBulkStage}
              disabled={busy || !bulkStage}
            >
              {bulkLoading && <Loader2 className="mr-1 size-4 animate-spin" />}
              적용
            </Button>
          </>
        }
      >
        <span className="text-sm font-semibold">{selected.size}개 선택됨</span>
      </FloatingActionBar>
    </div>
  )
}
