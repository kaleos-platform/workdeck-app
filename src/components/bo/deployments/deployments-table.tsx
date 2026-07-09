'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { ExternalLink, RotateCcw, X, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type Deployment = {
  id: string
  status: string
  platformUrl: string | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt: string
  scheduledAt?: string | null
  deletedAt?: string | null
  post: { id: string; title: string }
  channel: { id: string; name: string; platform: string }
  variant: { id: string; status: string }
}

type Props = {
  deployments: Deployment[]
}

// ─── 플랫폼 라벨 ───────────────────────────────────────────────────────────────

function platformLabel(platform: string): string {
  switch (platform) {
    case 'NAVER_BLOG':
      return '네이버 블로그'
    case 'TISTORY':
      return '티스토리'
    case 'OWN_HOMEPAGE':
      return '자사 홈페이지'
    default:
      return platform
  }
}

// ─── 플랫폼 배지 ───────────────────────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <Badge variant="outline" className="text-xs">
      {platformLabel(platform)}
    </Badge>
  )
}

// ─── 배포 상태 배지 ────────────────────────────────────────────────────────────

function DeploymentStatusBadge({
  status,
  scheduledAt,
}: {
  status: string
  scheduledAt?: string | null
}) {
  const isScheduled = status === 'PENDING' && scheduledAt && new Date(scheduledAt) > new Date()

  if (isScheduled) {
    return <Badge className="bg-blue-100 text-xs text-blue-700 hover:bg-blue-100">예약됨</Badge>
  }

  switch (status) {
    case 'EXPORTED':
      return (
        <Badge className="bg-blue-100 text-xs text-blue-700 hover:bg-blue-100">내보내기 완료</Badge>
      )
    case 'PUBLISHED':
      return (
        <Badge className="bg-emerald-100 text-xs text-emerald-700 hover:bg-emerald-100">
          게시됨
        </Badge>
      )
    case 'PUBLISHING':
      return (
        <Badge className="bg-yellow-100 text-xs text-yellow-700 hover:bg-yellow-100">
          <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
          게시 중
        </Badge>
      )
    case 'PENDING':
      return (
        <Badge className="bg-slate-100 text-xs text-slate-600 hover:bg-slate-100">대기 중</Badge>
      )
    case 'FAILED':
      return <Badge className="bg-red-100 text-xs text-red-700 hover:bg-red-100">실패</Badge>
    case 'CANCELED':
      return (
        <Badge variant="secondary" className="text-xs">
          취소됨
        </Badge>
      )
    case 'DELETING':
      return (
        <Badge className="bg-amber-100 text-xs text-amber-700 hover:bg-amber-100">
          <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
          삭제 중
        </Badge>
      )
    case 'DELETED':
      return (
        <Badge variant="secondary" className="text-xs">
          삭제됨
        </Badge>
      )
    default:
      return (
        <Badge variant="secondary" className="text-xs">
          {status}
        </Badge>
      )
  }
}

// ─── 날짜 포맷 ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${min}`
}

// ─── 삭제 확인 다이얼로그 ─────────────────────────────────────────────────────

function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onConfirm: () => void
  loading: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>게시글 삭제</DialogTitle>
          <DialogDescription>
            네이버 블로그에서 글이 삭제됩니다. 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={loading}>
              취소
            </Button>
          </DialogClose>
          <Button variant="destructive" size="sm" disabled={loading} onClick={onConfirm}>
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            삭제
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 배포 행 액션 셀 ──────────────────────────────────────────────────────────

function DeploymentActions({
  deployment,
  onRefresh,
}: {
  deployment: Deployment
  onRefresh: () => void
}) {
  const [loading, setLoading] = useState<'retry' | 'cancel' | 'delete' | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  async function handleRetry() {
    setLoading('retry')
    try {
      const res = await fetch(`/api/bo/deployments/${deployment.id}/retry`, { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '재시도 실패')
      }
      toast.success('재시도를 시작했습니다')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '재시도 실패')
    } finally {
      setLoading(null)
    }
  }

  async function handleCancel() {
    setLoading('cancel')
    try {
      const res = await fetch(`/api/bo/deployments/${deployment.id}/cancel`, { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '취소 실패')
      }
      toast.success('배포가 취소되었습니다')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '취소 실패')
    } finally {
      setLoading(null)
    }
  }

  async function handleDelete() {
    setLoading('delete')
    try {
      const res = await fetch(`/api/bo/deployments/${deployment.id}/delete`, { method: 'POST' })
      if (res.status === 409) {
        toast.error('이미 삭제가 진행 중입니다')
        setDeleteDialogOpen(false)
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '삭제 실패')
      }
      toast.success('삭제 요청이 접수되었습니다')
      setDeleteDialogOpen(false)
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setLoading(null)
    }
  }

  const isScheduled =
    deployment.status === 'PENDING' &&
    deployment.scheduledAt != null &&
    new Date(deployment.scheduledAt) > new Date()

  const showDelete =
    deployment.status === 'PUBLISHED' && deployment.channel.platform === 'NAVER_BLOG'

  return (
    <div className="flex items-center gap-1">
      {deployment.status === 'FAILED' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-0.5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          disabled={loading !== null}
          onClick={() => void handleRetry()}
        >
          {loading === 'retry' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          재시도
        </Button>
      )}

      {(deployment.status === 'PENDING' || isScheduled) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-0.5 px-1.5 text-xs text-muted-foreground hover:text-destructive"
          disabled={loading !== null}
          onClick={() => void handleCancel()}
        >
          {loading === 'cancel' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          취소
        </Button>
      )}

      {showDelete && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-0.5 px-1.5 text-xs text-muted-foreground hover:text-destructive"
            disabled={loading !== null}
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-3 w-3" />
            삭제
          </Button>
          <DeleteConfirmDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            onConfirm={() => void handleDelete()}
            loading={loading === 'delete'}
          />
        </>
      )}
    </div>
  )
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function DeploymentsTable({ deployments }: Props) {
  const router = useRouter()

  function handleRefresh() {
    router.refresh()
  }

  if (deployments.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">배포 이력이 없습니다.</p>
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              포스트
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              채널
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              플랫폼
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              상태
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              오류
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              시각
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              링크 / 액션
            </th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((d) => {
            const isScheduled =
              d.status === 'PENDING' &&
              d.scheduledAt != null &&
              new Date(d.scheduledAt) > new Date()
            const isDeleted = d.status === 'DELETED'

            return (
              <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="max-w-[180px] truncate px-4 py-2.5 text-xs">{d.post.title}</td>
                <td className="px-4 py-2.5 text-xs">{d.channel.name}</td>
                <td className="px-4 py-2.5">
                  <PlatformBadge platform={d.channel.platform} />
                </td>
                <td className="px-4 py-2.5">
                  <DeploymentStatusBadge status={d.status} scheduledAt={d.scheduledAt} />
                </td>
                <td className="max-w-[160px] px-4 py-2.5">
                  {d.errorMessage ? (
                    <span
                      className="block truncate text-xs text-destructive"
                      title={`${d.errorCode ? `[${d.errorCode}] ` : ''}${d.errorMessage}`}
                    >
                      {d.errorCode && (
                        <span className="mr-1 font-mono text-[10px]">[{d.errorCode}]</span>
                      )}
                      {d.errorMessage}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {isScheduled && d.scheduledAt
                    ? `예약 ${formatShortDate(d.scheduledAt)}`
                    : formatDate(d.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    {/* 링크: DELETED면 취소선 텍스트, 아니면 일반 링크 */}
                    {d.platformUrl &&
                      (isDeleted ? (
                        <span className="text-xs text-muted-foreground line-through">
                          {d.platformUrl}
                        </span>
                      ) : (
                        <a
                          href={d.platformUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          보기
                        </a>
                      ))}
                    {/* 액션: 링크와 병렬 표시 */}
                    <DeploymentActions deployment={d} onRefresh={handleRefresh} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
