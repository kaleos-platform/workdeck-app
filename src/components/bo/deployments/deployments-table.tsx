'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExternalLink, RotateCcw, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type Deployment = {
  id: string
  status: string
  platformUrl: string | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt: string
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

function DeploymentStatusBadge({ status }: { status: string }) {
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

// ─── 배포 행 액션 셀 ──────────────────────────────────────────────────────────

function DeploymentActions({
  deployment,
  onRefresh,
}: {
  deployment: Deployment
  onRefresh: () => void
}) {
  const [loading, setLoading] = useState<'retry' | 'cancel' | null>(null)

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

  if (deployment.status === 'FAILED') {
    return (
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
    )
  }

  if (deployment.status === 'PENDING') {
    return (
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
    )
  }

  return null
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
          {deployments.map((d) => (
            <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="max-w-[180px] truncate px-4 py-2.5 text-xs">{d.post.title}</td>
              <td className="px-4 py-2.5 text-xs">{d.channel.name}</td>
              <td className="px-4 py-2.5">
                <PlatformBadge platform={d.channel.platform} />
              </td>
              <td className="px-4 py-2.5">
                <DeploymentStatusBadge status={d.status} />
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
                {formatDate(d.createdAt)}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-1">
                  {d.platformUrl ? (
                    <a
                      href={d.platformUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      보기
                    </a>
                  ) : (
                    <DeploymentActions deployment={d} onRefresh={handleRefresh} />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
