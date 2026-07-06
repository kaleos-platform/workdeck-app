'use client'

import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type Deployment = {
  id: string
  status: string
  platformUrl: string | null
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
        <Badge className="bg-yellow-100 text-xs text-yellow-700 hover:bg-yellow-100">게시 중</Badge>
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

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function DeploymentsTable({ deployments }: Props) {
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
              시각
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
              링크
            </th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((d) => (
            <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="max-w-[200px] truncate px-4 py-2.5 text-xs">{d.post.title}</td>
              <td className="px-4 py-2.5 text-xs">{d.channel.name}</td>
              <td className="px-4 py-2.5">
                <PlatformBadge platform={d.channel.platform} />
              </td>
              <td className="px-4 py-2.5">
                <DeploymentStatusBadge status={d.status} />
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                {formatDate(d.createdAt)}
              </td>
              <td className="px-4 py-2.5">
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
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
