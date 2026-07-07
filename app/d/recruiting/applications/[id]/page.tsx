// 지원서 상세(server component). PII 는 서버에서만 복호화해 HTML 로 렌더(클라이언트 prop 미전달).
// 상호작용(상태 변경·코멘트·알림·블랙리스트·다운로드)은 PII 없는 client island 로 분리.
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { resolveDeckContext } from '@/lib/api-helpers'
import { getApplicationDetail } from '@/lib/hiring/applications'
import type { ApplicationEntryValue } from '@/lib/hiring/pii'
import { RECRUITING_APPLICATIONS_PATH } from '@/lib/deck-routes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DuplicatedBadge, BlacklistBadge } from '@/components/hiring-applicants/badges'
import { StageControls } from '@/components/hiring-applicants/stage-controls'
import { CommentThread } from '@/components/hiring-applicants/comment-thread'
import { NotificationSender } from '@/components/hiring-applicants/notification-sender'
import { BlacklistButton, FileDownloadList } from '@/components/hiring-applicants/detail-actions'
import { NOTIFICATION_LABELS } from '@/lib/hiring/applications'

type Params = { params: Promise<{ id: string }> }

const STANDARD_KEYS = new Set(['name', 'phone', 'email', 'address'])

export default async function ApplicationDetailPage({ params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const { id } = await params

  const detail = await getApplicationDetail(resolved.space.id, id)
  if (!detail) notFound()
  const { app, pii, blacklisted } = detail

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
        {app.duplicated && <DuplicatedBadge />}
        {blacklisted && <BlacklistBadge />}
      </div>
      <p className="text-sm text-muted-foreground">
        {app.posting?.title ?? '(삭제된 공고)'}
        {app.postingPosition?.name ? ` · ${app.postingPosition.name}` : ''} · 지원일{' '}
        {app.createdAt.toLocaleString('ko-KR')}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* 지원자 정보 (복호화 PII — 서버 렌더) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">지원자 정보</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Field label="이름" value={pii.name} />
                <Field label="연락처" value={pii.phone} />
                <Field label="이메일" value={pii.email} />
                <Field label="주소" value={pii.address} />
                {app.stores.length > 0 && (
                  <Field label="희망 매장" value={app.stores.map((s) => s.store.name).join(', ')} />
                )}
                {app.referrer && <Field label="유입 경로" value={app.referrer} />}
              </dl>
            </CardContent>
          </Card>

          {/* 제출 항목 (커스텀) */}
          {customEntries.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">제출 항목</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {customEntries.map((e) => (
                    <div key={e.key} className="grid grid-cols-3 gap-2">
                      <dt className="text-muted-foreground">{e.label || e.key}</dt>
                      <dd className="col-span-2 whitespace-pre-wrap">
                        {Array.isArray(e.value) ? e.value.join(', ') : String(e.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          {/* 첨부 파일 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">첨부 파일</CardTitle>
            </CardHeader>
            <CardContent>
              <FileDownloadList
                applicationId={app.id}
                files={app.files.map((f) => ({
                  id: f.id,
                  fileName: f.fileName,
                  sizeBytes: f.sizeBytes,
                }))}
              />
            </CardContent>
          </Card>

          {/* 내부 코멘트 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">내부 코멘트</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentThread
                applicationId={app.id}
                currentUserId={resolved.user.id}
                initial={app.comments.map((c) => ({
                  id: c.id,
                  userId: c.userId,
                  content: c.content,
                  createdAt: c.createdAt.toISOString(),
                  editedAt: c.editedAt ? c.editedAt.toISOString() : null,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        {/* 우측: 상태 관리 + 액션 */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">전형 상태</CardTitle>
            </CardHeader>
            <CardContent>
              <StageControls
                applicationId={app.id}
                stage={app.stage}
                hiringStage={app.hiringStage}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">액션</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <NotificationSender applicationId={app.id} />
              <BlacklistButton applicationId={app.id} blacklisted={blacklisted} />
            </CardContent>
          </Card>

          {/* 발송 이력 */}
          {app.notifications.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">알림 발송 이력</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs">
                  {app.notifications.map((n) => (
                    <li key={n.id} className="flex items-center justify-between gap-2">
                      <span className="font-medium">{NOTIFICATION_LABELS[n.notiType]}</span>
                      <span className="text-muted-foreground">
                        {n.createdAt.toLocaleDateString('ko-KR')}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || '-'}</dd>
    </div>
  )
}
