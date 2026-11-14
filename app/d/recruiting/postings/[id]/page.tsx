import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { resolveDeckContext } from '@/lib/api-helpers'
import { getPostingDetail } from '@/lib/hiring/postings'
import { renderPostingEmbed } from '@/lib/hiring/render-embed-html'
import { PostingDetail } from '@/components/hiring-posts/posting-detail'
import { countApplicationsByStatus } from '@/lib/hiring/applications'
import {
  ApplicationsListSection,
  type ApplicationsSearchParams,
} from '@/components/hiring-applicants/applications-list-section'
import { getRecruitingPostingPath } from '@/lib/deck-routes'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<ApplicationsSearchParams & { tab?: string | string[] }>
}

async function resolveOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const forwardedProto = h.get('x-forwarded-proto')
  const proto = forwardedProto ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

// 공고 상세 페이지 — 지원서/공고 링크, 임베드 HTML, 상태 액션을 제공하는 링크 중심 화면
export default async function PostingDetailPage({ params, searchParams }: PageProps) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const { id } = await params
  const { tab: rawTab, ...listParams } = await searchParams
  const tab = rawTab === 'applicants' || rawTab === 'content' ? rawTab : 'recruit'

  const posting = await getPostingDetail(resolved.space.id, id)
  if (!posting) notFound()

  // 탭 라벨의 지원자 수 — 삭제되지 않은 이 공고의 전체 지원서(탭 필터와 무관)
  const applicantCount = (await countApplicationsByStatus(resolved.space.id, { postingId: id })).all

  const origin = await resolveOrigin()
  const embed = renderPostingEmbed({
    posting: {
      uuid: posting.uuid,
      contents: posting.contents.map((c) => ({
        contentType: c.contentType as 'image' | 'text' | 'button' | 'positions' | 'design',
        data: c.data,
        imagePath: c.imagePath,
      })),
      positions: posting.positions.map((p) => ({
        name: p.name,
        jobType: p.jobType,
        payFrequency: p.payFrequency,
        payAmount: p.payAmount,
        workDays: p.workDays,
        workStartAt: p.workStartAt,
        workEndAt: p.workEndAt,
        headcount: p.headcount,
        experience: p.experience,
        education: p.education,
        jobDescription: p.jobDescription,
      })),
    },
    origin,
  })

  return (
    <PostingDetail
      posting={{
        id: posting.id,
        uuid: posting.uuid,
        title: posting.title,
        status: posting.status,
        publishedAt: posting.publishedAt?.toISOString() ?? null,
        closingDate: posting.closingDate ? posting.closingDate.toISOString() : null,
      }}
      origin={origin}
      embedHtml={embed.html}
      embedIssues={embed.issues}
      usesFormLink={embed.usesFormLink}
      tab={tab}
      applicantCount={applicantCount}
    >
      {tab === 'applicants' && (
        <ApplicationsListSection
          spaceId={resolved.space.id}
          canExportExcel={resolved.role === 'OWNER' || resolved.role === 'ADMIN'}
          raw={listParams}
          lockedPostingId={id}
          basePath={getRecruitingPostingPath(id)}
          baseQuery={{ tab: 'applicants' }}
        />
      )}
    </PostingDetail>
  )
}
