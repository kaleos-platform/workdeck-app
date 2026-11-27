import { cache } from 'react'
import { isHiringDeadlinePassed } from '@/lib/hiring/closing-date'
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
import { BookOpen, Globe, Instagram, Youtube } from 'lucide-react'
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
import { HIRING_PROSE_CLASS } from '@/lib/hiring/prose'
import { buttonBlockStyle } from '@/lib/hiring/button-color'
import { buildAppUrl, buildMarketingUrl } from '@/lib/domain'

type Params = { params: Promise<{ uuid: string }>; searchParams: Promise<{ preview?: string }> }

// generateMetadata 와 본문이 같은 요청에서 한 번만 조회하도록 캐시한다
const loadPosting = cache(async (uuid: string) =>
  prisma.hiringPosting.findUnique({
    where: { uuid },
    include: {
      // 공고의 spaceId 로만 조인 — 다른 공간 값이 섞일 경로 없음
      space: {
        select: {
          hiringCompanyProfile: {
            select: {
              companyName: true,
              intro: true,
              homepageUrl: true,
              blogUrl: true,
              instagramUrl: true,
              youtubeUrl: true,
              showIntro: true,
            },
          },
        },
      },
      positions: { orderBy: { createdAt: 'asc' } },
      stores: { include: { store: { select: { name: true, roadAddress: true, spaceId: true } } } },
      contents: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          spaceId: true,
          contentType: true,
          data: true,
          imagePath: true,
          sortOrder: true,
        },
      },
    },
  })
)

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

type LoadedPosting = NonNullable<Awaited<ReturnType<typeof loadPosting>>>

// 본문·JSON-LD·메타가 같은 필터(spaceId 일치)를 쓰도록 한 곳에서 거른다.
function filterPosting(posting: LoadedPosting) {
  return {
    positions: posting.positions.filter((position) => position.spaceId === posting.spaceId),
    stores: posting.stores.filter(({ store }) => store.spaceId === posting.spaceId),
    contents: posting.contents.filter((content) => content.spaceId === posting.spaceId),
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { uuid } = await params
  const posting = await loadPosting(uuid)
  if (!posting || !['ACTIVE', 'CLOSED'].includes(posting.status)) return { title: '채용 공고' }
  const { positions, stores } = filterPosting(posting)
  const title = `${posting.title} · 채용 공고`
  const region = stores.map((s) => s.store.roadAddress).find(Boolean)
  // 공간 이름은 고객 내부용일 수 있어 검색 설명에 넣지 않는다
  const description = [positions.map((p) => p.name).join(', '), region]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 120)
  const url = buildAppUrl(`/p/${uuid}`)
  const expired = posting.status === 'CLOSED' || isHiringDeadlinePassed(posting.closingDate)
  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: url },
    openGraph: { title, ...(description ? { description } : {}), url, type: 'website' },
    ...(expired ? { robots: { index: false } } : {}),
  }
}

export default async function PublicPostingPage({ params, searchParams }: Params) {
  const { uuid } = await params
  const { preview } = await searchParams
  const posting = await loadPosting(uuid)

  if (!posting || posting.status === 'ARCHIVED') notFound()

  const isPreview =
    posting.status === 'DRAFT' && (await isSpaceMemberPreview(preview, posting.spaceId))
  if (posting.status === 'DRAFT' && !isPreview) notFound()

  const { positions, stores, contents } = filterPosting(posting)
  const isClosed =
    !isPreview && (posting.status === 'CLOSED' || isHiringDeadlinePassed(posting.closingDate))
  const profile = posting.space.hiringCompanyProfile
  const placeLabel =
    stores.length > 1 ? `${stores[0].store.name} 외 ${stores.length - 1}곳` : stores[0]?.store.name
  const applyHref = `${getHiringPublicApplyPath(uuid)}${isPreview ? '?preview=1' : ''}`

  // 마감일 D-day (KST 기준 날짜 비교 — closingDate는 UTC 자정으로 저장된 날짜값)
  const closingLabel = (() => {
    if (!posting.closingDate) return null
    const closing = posting.closingDate
    const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
    const closingStr = closing.toISOString().slice(0, 10)
    const diffDays = Math.round(
      (Date.parse(closingStr) - Date.parse(todayKst)) / (24 * 60 * 60 * 1000)
    )
    const dateText = `${closing.getUTCFullYear()}. ${closing.getUTCMonth() + 1}. ${closing.getUTCDate()}. 마감`
    if (diffDays < 0) return dateText
    return `${diffDays === 0 ? 'D-DAY' : `D-${diffDays}`} · ${dateText}`
  })()

  return (
    <article className="space-y-6">
      {isPreview && (
        <div className="sticky top-0 z-50 -mx-4 -mt-4 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900 shadow-sm sm:-mx-6 sm:-mt-6 dark:bg-amber-950 dark:text-amber-200">
          미리보기 — 발행 전 화면입니다
        </div>
      )}

      <header className="space-y-1">
        {profile && <p className="text-base font-semibold">{profile.companyName}</p>}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${
                isPreview ? 'bg-amber-500' : isClosed ? 'bg-muted-foreground' : 'bg-emerald-500'
              }`}
            />
            {isPreview ? '발행 전' : isClosed ? '마감' : '모집 중'}
          </span>
          {isPreview ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                지원 접수 전 ·{' '}
                {posting.closingDate
                  ? `설정 마감일 ${posting.closingDate.toISOString().slice(0, 10)}`
                  : '상시 모집'}
              </span>
            </>
          ) : (
            !isClosed && (
              <>
                <span aria-hidden="true">·</span>
                <span>{closingLabel ?? '상시 모집'}</span>
              </>
            )
          )}
          {stores.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{placeLabel}</span>
            </>
          )}
        </p>
        {/* 기업 정보가 없는 공간은 주소를 머리글에 그대로 둔다 */}
        {!profile && stores.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {stores
              .map((s) =>
                s.store.roadAddress ? `${s.store.name} (${s.store.roadAddress})` : s.store.name
              )
              .join(', ')}
          </p>
        )}
      </header>

      {/* 마감 안내 — 헤더 바로 아래 */}
      {isClosed && (
        <div className="rounded-lg border bg-muted/50 p-4 text-center text-sm text-muted-foreground">
          마감된 공고입니다. 지원을 받지 않습니다.
          {closingLabel && <span className="ml-1">({closingLabel})</span>}
        </div>
      )}

      {/* 상세 본문 — image / text / button / positions 블록을 순서대로 렌더 */}
      {contents.length > 0 && (
        <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
          {contents.map((c) =>
            (c.contentType === 'image' || c.contentType === 'design') && c.imagePath ? (
              <ImageContentBlock key={c.id} content={c} applyHref={applyHref} isClosed={isClosed} />
            ) : c.contentType === 'text' && c.data ? (
              <div
                key={c.id}
                className={`p-6 ${HIRING_PROSE_CLASS} [&_img]:h-auto [&_img]:max-w-full`}
                dangerouslySetInnerHTML={{ __html: renderTiptapHtml(c.data) }}
              />
            ) : c.contentType === 'button' && c.data ? (
              (() => {
                const btn = c.data as {
                  title?: string
                  linkType?: string
                  url?: string
                  color?: string
                }
                if (!btn.title) return null
                const isForm = btn.linkType === 'form'
                const btnCls =
                  'inline-flex h-10 w-full items-center justify-center rounded-md px-6 text-sm font-medium shadow transition-opacity hover:opacity-90'
                const style = buttonBlockStyle(btn.color)
                return (
                  <div key={c.id} className="p-6">
                    {isClosed ? (
                      // 마감: 버튼 비활성
                      <span
                        aria-disabled="true"
                        style={style}
                        className={`${btnCls} pointer-events-none opacity-50`}
                      >
                        {btn.title}
                      </span>
                    ) : isForm ? (
                      <Link href={applyHref} style={style} className={btnCls}>
                        {btn.title}
                      </Link>
                    ) : (
                      <a
                        href={btn.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={style}
                        className={btnCls}
                      >
                        {btn.title}
                      </a>
                    )}
                  </div>
                )
              })()
            ) : c.contentType === 'positions' && positions.length > 0 ? (
              <div key={c.id} className="space-y-4 p-6">
                <h2 className="text-sm font-semibold">모집 부문 · 근무조건</h2>
                {positions.map((p) => {
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

      {profile && <CompanyFooter profile={profile} stores={stores.map((s) => s.store)} />}

      {process.env.HIRING_PUBLIC_POWERED_BY !== 'off' && (
        <footer className="pb-2 text-center text-xs text-muted-foreground">
          <a
            href={buildMarketingUrl(
              '/recruiting?utm_source=job_page&utm_medium=referral&utm_campaign=public_posting'
            )}
            target="_blank"
            rel="noopener"
            className="hover:underline"
          >
            made with <span className="underline underline-offset-2">workdeck</span>
          </a>
        </footer>
      )}
    </article>
  )
}

// image·design 블록 이미지 — data.link 가 form/url 이면 링크로 래핑. 마감 시 링크 비활성(button 과 동일).
function ImageContentBlock({
  content,
  applyHref,
  isClosed,
}: {
  content: { imagePath: string | null; data: unknown }
  applyHref: string
  isClosed: boolean
}) {
  const img = (
    <Image
      src={hiringAssetPublicUrl(content.imagePath as string)}
      alt="공고 상세"
      width={1200}
      height={1600}
      unoptimized
      className="h-auto w-full"
    />
  )
  const link = (content.data as { link?: { linkType?: string; url?: string } } | null)?.link
  if (!isClosed && link?.linkType === 'form') {
    return (
      <Link href={applyHref} className="block">
        {img}
      </Link>
    )
  }
  if (!isClosed && link?.linkType === 'url' && link.url) {
    return (
      <a href={link.url} target="_blank" rel="noopener noreferrer" className="block">
        {img}
      </a>
    )
  }
  return img
}

function ConditionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

type CompanyProfile = NonNullable<LoadedPosting['space']['hiringCompanyProfile']>

// 기업 소개 푸터 — 카드 없이 작은 회색 글씨. 근무 장소는 소개 표시 설정과 무관하게 항상 남긴다.
function CompanyFooter({
  profile,
  stores,
}: {
  profile: CompanyProfile
  stores: { name: string; roadAddress: string | null }[]
}) {
  const links = [
    { href: profile.homepageUrl, label: '홈페이지', Icon: Globe },
    { href: profile.blogUrl, label: '블로그', Icon: BookOpen },
    { href: profile.instagramUrl, label: '인스타그램', Icon: Instagram },
    { href: profile.youtubeUrl, label: '유튜브', Icon: Youtube },
    // 저장 시 https 만 받지만 렌더에서도 한 번 더 거른다(javascript: 등 차단)
  ].filter((l): l is typeof l & { href: string } => !!l.href?.startsWith('https://'))
  const showIntro = profile.showIntro && !!profile.intro
  const showLinks = profile.showIntro && links.length > 0

  return (
    <section className="space-y-4 border-t pt-6 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{profile.companyName}</p>
      {showIntro && <p className="whitespace-pre-line">{profile.intro}</p>}
      {showLinks && (
        <div className="-ml-2 flex flex-wrap gap-1">
          {links.map(({ href, label, Icon }) => (
            <Button key={label} variant="ghost" size="sm" asChild>
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                <Icon aria-hidden="true" />
                {label}
              </a>
            </Button>
          ))}
        </div>
      )}
      {stores.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-xs font-medium text-foreground">근무 장소</h2>
          <ul className="space-y-0.5 text-xs">
            {stores.map((s, i) => (
              <li key={i}>{s.roadAddress ? `${s.name} — ${s.roadAddress}` : s.name}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
