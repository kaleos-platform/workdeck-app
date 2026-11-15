// 지원서 상세(server component). PII 는 서버에서만 복호화해 HTML 로 렌더(클라이언트 prop 미전달).
// 상호작용(상태 변경·메모·연락·블랙리스트·다운로드)은 client island 로 분리. 휴대폰·이메일 복사는 값을
// prop 으로 받지 않고 서버 렌더된 DOM 텍스트를 읽는다.
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { resolveDeckContext } from '@/lib/api-helpers'
import { fileFieldLabel } from '@/lib/hiring/file-fields'
import { getApplicationDetail } from '@/lib/hiring/applications'
import { getApplicationHistory } from '@/lib/hiring/migration/application-history'
import { ApplicationHistory } from '@/components/hiring-applicants/application-history'
import type { ApplicationEntryValue } from '@/lib/hiring/pii'
import { RECRUITING_APPLICATIONS_PATH } from '@/lib/deck-routes'
import { DuplicatedBadge, BlacklistBadge } from '@/components/hiring-applicants/badges'
import { ApplicationStatusBadge } from '@/components/hiring-applicants/application-status-badge'
import { MemoPanel } from '@/components/hiring-applicants/memo-panel'
import { DetailActionBar } from '@/components/hiring-applicants/detail-action-bar'
import { CopyValueButton } from '@/components/hiring-applicants/copy-value-button'
import { PreQuestions } from '@/components/hiring-applicants/pre-questions'
import { BlacklistButton, FileDownloadList } from '@/components/hiring-applicants/detail-actions'

type Params = { params: Promise<{ id: string }> }

const STANDARD_KEYS = new Set(['name', 'phone', 'email', 'address'])

export default async function ApplicationDetailPage({ params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const { id } = await params

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

  return (
    <div className="space-y-4 p-6">
      <Link
        href={RECRUITING_APPLICATIONS_PATH}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← 목록으로
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{pii.name ?? '(이름 없음)'}</h1>
        <ApplicationStatusBadge stage={app.stage} hiringStage={app.hiringStage} />
        {app.duplicated && <DuplicatedBadge />}
        {blacklisted && <BlacklistBadge />}
        <div className="ml-auto">
          <BlacklistButton applicationId={app.id} blacklisted={blacklisted} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {app.posting?.title ?? '(삭제된 공고)'}
        {app.postingPosition?.name ? ` · ${app.postingPosition.name}` : ''} · 지원일{' '}
        {app.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
        {app.referrer ? ` · ${app.referrer}` : ''}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex min-h-[calc(100dvh-14rem)] min-w-0 flex-col gap-6 lg:col-span-2">
          {/* 기본 정보 (복호화 PII — 서버 렌더) */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">기본 정보</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
              <Field label="이름" value={pii.name} />
              <Field label="휴대폰" value={pii.phone} copyLabel="휴대폰" />
              <Field label="이메일" value={pii.email} copyLabel="이메일" />
              <Field label="거주 지역" value={pii.address} />
              <Field
                label="지원 공고/포지션"
                value={`${app.posting?.title ?? '(삭제된 공고)'}${
                  app.postingPosition?.name ? ` · ${app.postingPosition.name}` : ''
                }`}
              />
              {app.stores.length > 0 && (
                <Field label="희망 매장" value={app.stores.map((s) => s.store.name).join(', ')} />
              )}
              {app.referrer && <Field label="유입 경로" value={app.referrer} />}
              <div className="flex flex-col gap-1 sm:col-span-2">
                <dt className="text-xs text-muted-foreground">지원 서류</dt>
                <dd>
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

          <DetailActionBar
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
          />
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
  )
}

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
    <div className="flex flex-col gap-0.5" data-copy-root>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 font-medium">
        <span data-copy-value>{value || '-'}</span>
        {copyLabel && value && <CopyValueButton label={copyLabel} />}
      </dd>
    </div>
  )
}
