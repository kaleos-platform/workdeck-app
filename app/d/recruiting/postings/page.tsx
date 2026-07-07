import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { listPostings } from '@/lib/hiring/postings'
import { PostingsTable, type PostingRow } from '@/components/hiring-posts/postings-table'

// 공고 목록 페이지
export default async function PostingsPage() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')

  const rows = await listPostings(resolved.space.id)
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
          채용 공고를 만들고 발행해 공개 지원 페이지를 운영합니다.
        </p>
      </div>
      <PostingsTable postings={postings} />
    </div>
  )
}
