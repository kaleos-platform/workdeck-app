import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { listPostingPage } from '@/lib/hiring/posting-list'
import { PostingsTable, type PostingRow } from '@/components/hiring-posts/postings-table'

// 공고 목록 페이지
export default async function PostingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[]
    status?: string | string[]
    page?: string | string[]
  }>
}) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')

  const { rows, ...pagination } = await listPostingPage(resolved.space.id, await searchParams)
  const postings: PostingRow[] = rows.map((p) => ({
    id: p.id,
    uuid: p.uuid,
    title: p.title,
    status: p.status,
    closingDate: p.closingDate ? p.closingDate.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    applicantCount: p._count.applications,
  }))

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">공고 관리</h1>
        <p className="text-sm text-muted-foreground">
          공고를 만들고 HTML을 복사해 외부 채용사이트에 게시하세요. 지원자 접수도 관리할 수
          있습니다.
        </p>
      </div>
      <PostingsTable
        key={`${pagination.q}:${pagination.status}:${pagination.page}`}
        postings={postings}
        {...pagination}
      />
    </div>
  )
}
