'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { PostStatusBadge, POST_STATUS_LABEL } from './post-status-badge'
import type { BoPostStatus } from './post-status-badge'
import { getBlogOpsPostPath } from '@/lib/deck-routes'

type Post = {
  id: string
  title: string
  status: BoPostStatus
  targetKeyword: string | null
  material: { title: string }
  createdAt: string
  updatedAt: string
}

const ALL_STATUSES: BoPostStatus[] = [
  'GENERATING',
  'DRAFT',
  'IN_REVIEW',
  'PUBLISH_APPROVED',
  'PUBLISHED',
  'FAILED',
  'ARCHIVED',
]

function formatDate(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function PostsList() {
  const router = useRouter()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<BoPostStatus | 'ALL'>('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      const res = await fetch(`/api/bo/posts?${params.toString()}`)
      if (!res.ok) throw new Error('포스트 목록을 불러오지 못했습니다')
      const data = (await res.json()) as { posts: Post[] }
      setPosts(data.posts)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류 발생')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      {/* 상태 필터 */}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={statusFilter === 'ALL' ? 'default' : 'outline'}
          onClick={() => setStatusFilter('ALL')}
        >
          전체
        </Button>
        {ALL_STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? 'default' : 'outline'}
            onClick={() => setStatusFilter(s)}
          >
            {POST_STATUS_LABEL[s]}
          </Button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          로딩 중...
        </div>
      ) : error ? (
        <p className="py-4 text-sm text-destructive">{error}</p>
      ) : posts.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">조건에 맞는 포스트가 없습니다.</p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  제목
                </th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground sm:table-cell">
                  소재
                </th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground md:table-cell">
                  키워드
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  상태
                </th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground lg:table-cell">
                  수정일
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {posts.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => router.push(getBlogOpsPostPath(p.id))}
                >
                  <td className="px-4 py-3">
                    <p className="line-clamp-1 font-medium">{p.title}</p>
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-muted-foreground sm:table-cell">
                    <p className="line-clamp-1">{p.material.title}</p>
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">
                    {p.targetKeyword ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <PostStatusBadge status={p.status} />
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-muted-foreground lg:table-cell">
                    {formatDate(p.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
