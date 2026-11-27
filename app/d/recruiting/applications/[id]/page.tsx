// 지원서 상세(server component). PII 는 서버에서만 복호화해 HTML 로 렌더. 이메일·주소는 서버 HTML 전용,
// 휴대폰·이름만 연락 팝업용으로 DetailActionsProvider client prop 으로 넘긴다.
// 상호작용(상태 변경·메모·연락·블랙리스트·다운로드)은 client island 로 분리. 휴대폰·이메일 복사는 값을
// prop 으로 받지 않고 서버 렌더된 DOM 텍스트를 읽는다.
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { resolveDeckContext } from '@/lib/api-helpers'
import { fileFieldLabel } from '@/lib/hiring/file-fields'
import { formatPhone } from '@/lib/hiring/message-template'
import { getApplicationDetail } from '@/lib/hiring/applications'
import { getApplicationHistory } from '@/lib/hiring/migration/application-history'
import { ApplicationHistory } from '@/components/hiring-applicants/application-history'
import type { ApplicationEntryValue } from '@/lib/hiring/pii'
import { safeRecruitingReturnPath } from '@/lib/deck-routes'
import { DuplicatedBadge, BlacklistBadge } from '@/components/hiring-applicants/badges'
import { ApplicationStatusBadge } from '@/components/hiring-applicants/application-status-badge'
import { MemoPanel } from '@/components/hiring-applicants/memo-panel'
import {
  DetailActionBar,
  DetailActionButtons,
  DetailActionsProvider,
} from '@/components/hiring-applicants/detail-action-bar'
import { DeleteApplicantButton } from '@/components/hiring-applicants/delete-applicant-button'
import { CopyValueButton } from '@/components/hiring-applicants/copy-value-button'
import { PreQuestions } from '@/components/hiring-applicants/pre-questions'
import { BlacklistButton, FileDownloadList } from '@/components/hiring-applicants/detail-actions'

type Params = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string | string[] }>
}

const STANDARD_KEYS = new Set(['name', 'phone', 'email', 'address'])

export default async function ApplicationDetailPage({ params, searchParams }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const { id } = await params
  const backHref = safeRecruitingReturnPath((await searchParams).from)

  const detail = await getApplicationDetail(resolved.space.id, id)
  if (!detail) notFound()
  const { app, pii, blacklisted } = detail
  const history = await getApplicationHistory(resolved.space.id, app.id)

  const customEntries = ((app.applicationEntries as ApplicationEntryValue[] | null) ?? []).filter(
    (e) =>
      !STANDARD_KEYS.has(e.key) &&
      e.value != null &&
      !(Array.isArray(e.value) && e.value.length === 0)
  )

  const postingLabel = `${app.posting?.title ?? '(삭제된 공고)'}${
    app.postingPosition?.name ? ` · ${app.postingPosition.name}` : ''
  }`

  return (
    <DetailActionsProvider
      applicationId={app.id}
      stage={app.stage}
      hiringStage={app.hiringStage}
      phone={pii.phone}
      name={pii.name}
      postingTitle={app.posting?.title ?? null}
      positionName={app.postingPosition?.name ?? null}
      notifications={app.notifications.map((n) => ({
        id: n.id,
        notiType: n.notiType,
        createdAt: n.createdAt.toISOString(),
      }))}
    >
      <div className="space-y-4 p-6">
        <Link href={backHref} className="text-xs text-muted-foreground hover:text-foreground">
          ← 목록으로
        </Link>

        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{pii.name ?? '(이름 없음)'}</h1>
            <ApplicationStatusBadge stage={app.stage} hiringStage={app.hiringStage} />
            {app.duplicated && <DuplicatedBadge />}
            {blacklisted && <BlacklistBadge />}
            <DetailActionButtons className="ml-auto hidden lg:flex" />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm text-muted-foreground">
              {postingLabel} · 지원{' '}
              {app.createdAt.toLocaleString('ko-KR', {
                timeZone: 'Asia/Seoul',
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
            <div className="-ml-2 flex items-center gap-1 sm:ml-auto">
              <BlacklistButton applicationId={app.id} blacklisted={blacklisted} />
              {(resolved.role === 'OWNER' || resolved.role === 'ADMIN') && (
                <DeleteApplicantButton applicationId={app.id} returnTo={backHref} />
              )}
            </div>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-6 max-lg:min-h-[calc(100dvh-14rem)] lg:col-span-2">
            {/* 기본 정보 (복호화 PII — 서버 렌더). 이름·지원 공고는 헤더에 있어 반복하지 않는다. */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">기본 정보</h2>
              <dl className="divide-y rounded-lg border text-sm">
                <Field label="휴대폰" value={formatPhone(pii.phone)} copyLabel="휴대폰" />
                <Field label="이메일" value={pii.email} copyLabel="이메일" />
                <Field label="거주 지역" value={pii.address} />
                {app.stores.length > 0 && (
                  <Field label="희망 장소" value={app.stores.map((s) => s.store.name).join(', ')} />
                )}
                {app.referrer && <Field label="유입 경로" value={app.referrer} />}
                <div className={ROW}>
                  <dt className="text-muted-foreground">지원 서류</dt>
                  <dd className="min-w-0">
                    <FileDownloadList
                      applicationId={app.id}
                      files={app.files.map((f) => ({
                        id: f.id,
                        fileName: f.fileName,
                        fieldLabel: fileFieldLabel(app.applicationEntries, f.id),
                        sizeBytes: f.sizeBytes,
                      }))}
                    />
                  </dd>
                </div>
              </dl>
            </section>

            <PreQuestions entries={customEntries} />

            {history.status !== 'absent' && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  이전 기록(오프닝워크)
                </summary>
                <div className="mt-4">
                  <ApplicationHistory applicationId={app.id} result={history} />
                </div>
              </details>
            )}

            <DetailActionBar />
          </div>

          {/* 우측(데스크톱): 메모 스레드 sticky / 모바일: 제목 아래 요약 한 줄 */}
          <MemoPanel
            applicationId={app.id}
            currentUserId={resolved.user.id}
            legacyMemo={app.memo}
            initial={app.comments.map((c) => ({
              id: c.id,
              userId: c.userId,
              content: c.content,
              createdAt: c.createdAt.toISOString(),
              editedAt: c.editedAt ? c.editedAt.toISOString() : null,
            }))}
          />
        </div>
      </div>
    </DetailActionsProvider>
  )
}

const ROW = 'grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 px-4 py-2.5'

function Field({
  label,
  value,
  copyLabel,
}: {
  label: string
  value: string | null
  copyLabel?: string
}) {
  return (
    <div className={ROW} data-copy-root>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 font-medium">
        <span className="min-w-0 break-all" data-copy-value>
          {value || '-'}
        </span>
        {copyLabel && value && <CopyValueButton label={copyLabel} />}
      </dd>
    </div>
  )
}
