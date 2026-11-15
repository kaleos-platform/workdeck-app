import Link from 'next/link'
import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { NewPostingButton } from '@/components/hiring-posts/new-posting-button'
import { CopyApplyLinkButton } from '@/components/hiring-posts/copy-apply-link-button'
import { StageBadge, ProcessStageBadge } from '@/components/hiring-applicants/badges'
import { Button } from '@/components/ui/button'
import { formatDday, getRecruitingHomeSummary } from '@/lib/hiring/home-summary'
import { formatDateToYmdKst } from '@/lib/date-range'
import {
  RECRUITING_POSTINGS_PATH,
  RECRUITING_APPLICATIONS_PATH,
  getRecruitingApplicationPath,
  getRecruitingPostingDetailPath,
} from '@/lib/deck-routes'

const HIRING_LIST = `${RECRUITING_APPLICATIONS_PATH}?stage=HIRING`

export default async function RecruitingHomePage() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const { counts, weekCount, weekFrom, postings, recent } = await getRecruitingHomeSummary(
    resolved.space.id
  )
  const strip = [
    { label: '서류 접수', value: counts.APPLIED, href: `${HIRING_LIST}&process=APPLIED` },
    { label: '면접', value: counts.INTERVIEW, href: `${HIRING_LIST}&process=INTERVIEW` },
    { label: '최종 제안', value: counts.JOB_OFFER, href: `${HIRING_LIST}&process=JOB_OFFER` },
    {
      label: '최근 7일 신규 지원',
      value: weekCount,
      href: `${RECRUITING_APPLICATIONS_PATH}?from=${weekFrom}`,
    },
  ]
  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">모집 관리</h1>
          <p className="text-sm text-muted-foreground">
            모집 중인 공고와 지원자 처리 현황을 한눈에 확인하세요.
          </p>
        </div>
        <NewPostingButton />
      </div>

      <section aria-labelledby="home-open" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="home-open" className="text-sm font-medium">
            모집 중 공고
          </h2>
          <Button variant="outline" size="sm" asChild>
            <Link href={RECRUITING_POSTINGS_PATH}>전체 공고</Link>
          </Button>
        </div>
        {postings.length === 0 ? (
          <p className="text-sm text-muted-foreground">모집 중인 공고가 없습니다.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {postings.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <Link
                    href={getRecruitingPostingDetailPath(p.id)}
                    className="block truncate text-sm font-medium hover:underline"
                    title={p.title}
                  >
                    {p.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {p.closingDate
                      ? `${formatDday(p.closingDate)} · 마감 ${formatDateToYmdKst(p.closingDate).replaceAll('-', '. ')}.`
                      : '상시 모집'}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  진행 중 지원자 {p.inProgress}명
                </span>
                <CopyApplyLinkButton uuid={p.uuid} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="home-pending" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="home-pending" className="text-sm font-medium">
            처리할 지원자
          </h2>
          <Button variant="outline" size="sm" asChild>
            <Link href={RECRUITING_APPLICATIONS_PATH}>전체 지원자</Link>
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {strip.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className="flex flex-col gap-1 rounded-md border px-4 py-3 hover:bg-muted/50 focus-visible:outline-2"
              >
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <span className="text-xl font-semibold tabular-nums">{item.value}명</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="home-recent" className="space-y-3">
        <h2 id="home-recent" className="text-sm font-medium">
          최근 지원자
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">공고를 발행하면 지원서가 이곳에 쌓입니다.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {recent.map((a) => (
              <li key={a.id}>
                <Link
                  href={getRecruitingApplicationPath(a.id)}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-muted/50"
                >
                  <span className="w-20 font-medium">{a.maskedName ?? '-'}</span>
                  <span className="min-w-0 flex-1 basis-40 truncate text-muted-foreground">
                    {a.posting.title}
                  </span>
                  {a.stage === 'HIRING' ? (
                    <ProcessStageBadge stage={a.hiringStage} />
                  ) : (
                    <StageBadge stage={a.stage} />
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {a.createdAt.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
