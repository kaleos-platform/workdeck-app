'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Eye, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ProductApplyPatch } from '@/components/sh/products/product-basic-form'
import type { ExtractJob } from './types'

const STATUS_LABEL: Record<ExtractJob['status'], string> = {
  PENDING: '대기',
  RUNNING: '진행 중',
  SUCCEEDED: '완료',
  FAILED: '실패',
}

const SOURCE_KIND_LABEL: Record<string, string> = {
  URL: 'URL',
  TEXT: '텍스트',
  IMAGE: '이미지',
  PDF: 'PDF',
}

function summarizeSources(job: ExtractJob): string {
  if (job.sources.length === 0) return '-'
  const counts = new Map<string, number>()
  for (const s of job.sources) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
  return Array.from(counts.entries())
    .map(([kind, n]) => `${SOURCE_KIND_LABEL[kind] ?? kind} ${n}`)
    .join(', ')
}

type Props = {
  productId: string
  jobs: ExtractJob[]
  loading: boolean
  basicBusy: boolean
  onApply: (patch: ProductApplyPatch) => Promise<void>
  onReopen: (job: ExtractJob) => void
  onChanged: () => void
}

/** 추출 이력 목록 — 재열람/삭제/롤백. 실제 InvProduct 반영은 항상 onApply(폼 state 경유)로만 한다. */
export function ProductExtractHistory({
  productId,
  jobs,
  loading,
  basicBusy,
  onApply,
  onReopen,
  onChanged,
}: Props) {
  const [busyJobId, setBusyJobId] = useState<string | null>(null)

  const handleReopen = useCallback(
    async (jobId: string) => {
      setBusyJobId(jobId)
      try {
        const res = await fetch(`/api/sh/products/${productId}/extract/${jobId}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data?.message ?? '작업을 불러오지 못했습니다')
          return
        }
        // GET 상세는 { job, sources }로 분리 반환한다 — 리뷰 컴포넌트가 기대하는
        // ExtractJob.sources(서명 URL 포함) shape으로 합쳐준다.
        onReopen({ ...data.job, sources: data.sources ?? data.job.sources ?? [] })
      } finally {
        setBusyJobId(null)
      }
    },
    [productId, onReopen]
  )

  const handleDelete = useCallback(
    async (jobId: string) => {
      if (!confirm('이 추출 작업을 삭제하시겠습니까? 첨부 파일도 함께 삭제됩니다.')) return
      setBusyJobId(jobId)
      try {
        const res = await fetch(`/api/sh/products/${productId}/extract/${jobId}`, {
          method: 'DELETE',
        })
        if (!res.ok && res.status !== 204) {
          const data = await res.json().catch(() => ({}))
          toast.error(data?.message ?? '삭제에 실패했습니다')
          return
        }
        toast.success('삭제되었습니다')
        onChanged()
      } finally {
        setBusyJobId(null)
      }
    },
    [productId, onChanged]
  )

  const handleRollback = useCallback(
    async (job: ExtractJob) => {
      if (!confirm('적용을 되돌리시겠습니까? 적용 이전 값으로 복원됩니다.')) return
      setBusyJobId(job.id)
      try {
        const res = await fetch(`/api/sh/products/${productId}/extract/${job.id}/rollback`, {
          method: 'POST',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data?.message ?? '롤백에 실패했습니다')
          return
        }
        const before = (data.before ?? {}) as Record<string, unknown>
        const patch: ProductApplyPatch = {}
        if ('description' in before) patch.description = before.description as string | null
        if ('features' in before) patch.features = (before.features as string[]) ?? []
        if ('certifications' in before)
          patch.certifications = (before.certifications as string[]) ?? []
        if ('manufacturer' in before) patch.manufacturer = before.manufacturer as string | null
        if ('manufactureCountry' in before)
          patch.manufactureCountry = before.manufactureCountry as string | null

        // rollback 라우트는 이미 rolledBackAt을 찍었다 — 값 반영은 여기서 폼 autosave로 완료해야 한다.
        await onApply(patch)
        toast.success('롤백되었습니다')
        onChanged()
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `롤백 값 저장 실패: ${err.message}`
            : '롤백 값을 저장하지 못했습니다'
        )
      } finally {
        setBusyJobId(null)
      }
    },
    [productId, onApply, onChanged]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">추출 이력</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 추출 이력이 없습니다</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>시각</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>소재</TableHead>
                <TableHead>적용 여부</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const isBusy = busyJobId === job.id
                return (
                  <TableRow key={job.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(job.createdAt).toLocaleString('ko-KR')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          job.status === 'FAILED'
                            ? 'destructive'
                            : job.status === 'SUCCEEDED'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {STATUS_LABEL[job.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {summarizeSources(job)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {job.rolledBackAt ? (
                        <span className="text-muted-foreground">롤백됨</span>
                      ) : job.appliedAt ? (
                        <span className="text-emerald-600">적용됨</span>
                      ) : (
                        <span className="text-muted-foreground">미적용</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={isBusy}
                          onClick={() => handleReopen(job.id)}
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                          재열람
                        </Button>
                        {job.appliedAt && !job.rolledBackAt && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={isBusy || basicBusy}
                            onClick={() => handleRollback(job)}
                            title={
                              basicBusy
                                ? '기본 정보 저장 중입니다. 잠시 후 시도해주세요.'
                                : undefined
                            }
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            롤백
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={isBusy}
                          onClick={() => handleDelete(job.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
