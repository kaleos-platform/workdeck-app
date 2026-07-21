import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { resolveDeckContext } from '@/lib/api-helpers'
import { getPostingDetail } from '@/lib/hiring/postings'
import { renderPostingEmbedHtml } from '@/lib/hiring/render-embed-html'
import { PostingDetail } from '@/components/hiring-posts/posting-detail'

type PageProps = { params: Promise<{ id: string }> }

async function resolveOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const forwardedProto = h.get('x-forwarded-proto')
  const proto = forwardedProto ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

// 공고 상세 페이지 — 지원서/공고 링크, 임베드 HTML, 상태 액션을 제공하는 링크 중심 화면
export default async function PostingDetailPage({ params }: PageProps) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const { id } = await params

  const posting = await getPostingDetail(resolved.space.id, id)
  if (!posting) notFound()

  const origin = await resolveOrigin()
  const embedHtml = renderPostingEmbedHtml({
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
        closingDate: posting.closingDate ? posting.closingDate.toISOString() : null,
      }}
      origin={origin}
      embedHtml={embedHtml}
    />
  )
}
