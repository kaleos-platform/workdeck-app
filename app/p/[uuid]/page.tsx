// 공개 채용 공고 페이지(server component, 무인증).
// ACTIVE 만 공개. CLOSED → 마감 안내. 그 외 → 404.
// ?preview=1 + 스페이스 멤버인 경우 DRAFT 도 열람 가능(발행 전 미리보기).
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getHiringPublicApplyPath } from '@/lib/deck-routes'
import { getUser } from '@/hooks/use-user'
import {
  JOB_TYPE_LABELS,
  formatPay,
  formatWorkDays,
  formatWorkTime,
  hiringAssetPublicUrl,
} from '@/components/hiring-public/posting-labels'
import { renderTiptapHtml } from '@/lib/hiring/render-tiptap'

type Params = { params: Promise<{ uuid: string }>; searchParams: Promise<{ preview?: string }> }

async function loadPosting(uuid: string) {
  return prisma.hiringPosting.findUnique({
    where: { uuid },
    include: {
      positions: { orderBy: { createdAt: 'asc' } },
      stores: { include: { store: { select: { name: true, roadAddress: true } } } },
      contents: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, contentType: true, data: true, imagePath: true, sortOrder: true },
      },
    },
  })
}

// preview=1 요청 시 스페이스 멤버 여부 확인(DRAFT 열람 허용 조건)
async function isSpaceMemberPreview(preview: string | undefined, spaceId: string) {
  if (preview !== '1') return false
  const user = await getUser()
  if (!user) return false
  const membership = await prisma.spaceMember.findFirst({
    where: { userId: user.id, spaceId },
    select: { id: true },
  })
  return !!membership
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { uuid } = await params
  const posting = await prisma.hiringPosting.findUnique({
    where: { uuid },
    select: { title: true, status: true },
  })
  if (!posting) return { title: '채용 공고' }
  return { title: `${posting.title} · 채용 공고` }
}

export default async function PublicPostingPage({ params, searchParams }: Params) {
  const { uuid } = await params
  const { preview } = await searchParams
  const posting = await loadPosting(uuid)

  if (!posting || posting.status === 'ARCHIVED') notFound()

  const isPreview =
    posting.status === 'DRAFT' && (await isSpaceMemberPreview(preview, posting.spaceId))
  if (posting.status === 'DRAFT' && !isPreview) notFound()

  const isClosed = posting.status === 'CLOSED'

  return (
    <article className="space-y-6">
      {isPreview && (
        <div className="sticky top-0 z-50 -mx-4 -mt-4 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900 shadow-sm sm:-mx-6 sm:-mt-6 dark:bg-amber-950 dark:text-amber-200">
          미리보기 — 발행 전 화면입니다
        </div>
      )}

      <header className="space-y-3 rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          {isClosed ? (
            <Badge className="bg-muted text-muted-foreground">마감</Badge>
          ) : (
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              모집 중
            </Badge>
          )}
        </div>
        {posting.stores.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {posting.stores.map((s) => s.store.name).join(', ')}
          </p>
        )}
      </header>

      {/* 상세 본문 — image / text / button / positions 블록을 순서대로 렌더 */}
      {posting.contents.length > 0 && (
        <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
          {posting.contents.map((c) =>
            c.imagePath ? (
              <Image
                key={c.id}
                src={hiringAssetPublicUrl(c.imagePath)}
                alt="공고 상세"
                width={1200}
                height={1600}
                unoptimized
                className="h-auto w-full"
              />
            ) : c.contentType === 'text' && c.data ? (
              <div
                key={c.id}
                className="p-6 [&_a]:text-primary [&_a]:underline [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_img]:h-auto [&_img]:max-w-full [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:text-sm [&_p]:mb-2 [&_p]:text-sm [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-sm"
                dangerouslySetInnerHTML={{ __html: renderTiptapHtml(c.data) }}
              />
            ) : c.contentType === 'button' && c.data ? (
              (() => {
                const btn = c.data as { title?: string; linkType?: string; url?: string }
                if (!btn.title) return null
                const isForm = btn.linkType === 'form'
                return (
                  <div key={c.id} className="p-6">
                    {isForm ? (
                      <Button asChild size="lg" className="w-full">
                        <Link href={getHiringPublicApplyPath(uuid)}>{btn.title}</Link>
                      </Button>
                    ) : (
                      <Button asChild size="lg" className="w-full">
                        <a href={btn.url} target="_blank" rel="noopener noreferrer">
                          {btn.title}
                        </a>
                      </Button>
                    )}
                  </div>
                )
              })()
            ) : c.contentType === 'positions' && posting.positions.length > 0 ? (
              <div key={c.id} className="space-y-4 p-6">
                <h2 className="text-sm font-semibold">모집 부문 · 근무조건</h2>
                {posting.positions.map((p) => {
                  const workDays = formatWorkDays(p.workDays)
                  const workTime = formatWorkTime(p.workStartAt, p.workEndAt)
                  return (
                    <div key={p.id} className="rounded-md border p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{p.name}</span>
                        {p.jobType && (
                          <Badge variant="secondary" className="text-xs">
                            {JOB_TYPE_LABELS[p.jobType] ?? p.jobType}
                          </Badge>
                        )}
                        {p.headcount != null && (
                          <span className="text-xs text-muted-foreground">
                            {p.headcount}명 모집
                          </span>
                        )}
                      </div>
                      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                        <ConditionRow label="급여" value={formatPay(p.payFrequency, p.payAmount)} />
                        {workDays && <ConditionRow label="근무 요일" value={workDays} />}
                        {workTime && <ConditionRow label="근무 시간" value={workTime} />}
                        {p.experience && <ConditionRow label="경력" value={p.experience} />}
                        {p.education && <ConditionRow label="학력" value={p.education} />}
                      </dl>
                      {p.jobDescription && (
                        <p className="mt-3 text-xs whitespace-pre-wrap text-muted-foreground">
                          {p.jobDescription}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : null
          )}
        </section>
      )}

      {/* 지원 CTA */}
      <div className="sticky bottom-4 z-10">
        {isClosed ? (
          <div className="rounded-lg border bg-card p-4 text-center text-sm text-muted-foreground shadow-sm">
            마감된 공고입니다. 지원을 받지 않습니다.
          </div>
        ) : (
          <Button asChild size="lg" className="w-full shadow-sm">
            <Link href={getHiringPublicApplyPath(uuid)}>지원하기</Link>
          </Button>
        )}
      </div>
    </article>
  )
}

function ConditionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
