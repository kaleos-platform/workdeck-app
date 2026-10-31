import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { listPostingPage } from '@/lib/hiring/posting-list'
import { collectServerTimings } from '@/lib/coupang-ads/server-timing'
import { PostingsTable, type PostingRow } from '@/components/hiring-posts/postings-table'

type PostingSearchParams = {
  q?: string | string[]
  status?: string | string[]
  page?: string | string[]
}

async function loadPostings(params: PostingSearchParams) {
  const startedAt = performance.now()
  const { result: resolved, timings } = await collectServerTimings(() =>
    resolveDeckContext('recruiting')
  )
  if ('error' in resolved) redirect('/my-deck')

  const contextAt = performance.now()
  const { rows, ...pagination } = await listPostingPage(resolved.space.id, params)
  const queriedAt = performance.now()
  if (queriedAt - startedAt >= 500) {
    // 고객 식별자와 검색어 없이 느린 서버 조회 구간만 기록한다.
    console.info('[recruiting:postings:slow]', {
      contextMs: Math.round(contextAt - startedAt),
      queryMs: Math.round(queriedAt - contextAt),
      authUserMs: timings.auth_user === undefined ? null : Math.round(timings.auth_user),
      membershipMs:
        timings.auth_membership === undefined ? null : Math.round(timings.auth_membership),
      deckMs: timings.auth_deck === undefined ? null : Math.round(timings.auth_deck),
      membershipListMs:
        timings.membership_list === undefined ? null : Math.round(timings.membership_list),
      membershipCookieMs:
        timings.membership_cookie === undefined ? null : Math.round(timings.membership_cookie),
    })
  }
  return { rows, ...pagination }
}

// 공고 목록 페이지
export default async function PostingsPage({
  searchParams,
}: {
  searchParams: Promise<PostingSearchParams>
}) {
  const { rows, ...pagination } = await loadPostings(await searchParams)
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
