import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { addComment, isSentryApiConfigured, listComments } from '@/lib/sentry/api'
import { canApprove, parseAutofixState, shouldWriteNote } from '@/lib/sentry/autofix-status'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['request', 'skip']) }),
  z.object({
    action: z.literal('approve'),
    id: z.string().regex(/^\d{8}-\d{6}-[0-9a-f]{4}-[A-Za-z0-9-]{3,40}$/),
    sha: z.string().regex(/^[0-9a-f]{16}$/),
  }),
])

// POST /api/admin/errors/[issueId] — Sentry 이슈에 자동 수정 요청/제외/승인 노트를 남긴다
export async function POST(request: Request, { params }: { params: Promise<{ issueId: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { issueId } = await params
  if (!/^\d+$/.test(issueId)) return errorResponse('잘못된 요청입니다', 400)
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('잘못된 요청입니다', 400)
  if (!isSentryApiConfigured()) return errorResponse('Sentry API 가 설정되지 않았습니다', 503)

  const body = parsed.data
  const { action } = body
  let state
  try {
    state = parseAutofixState(await listComments(issueId))
  } catch {
    return errorResponse('Sentry 노트 조회 실패', 502)
  }
  if (body.action === 'approve') {
    if (!canApprove(state, body.id, body.sha)) {
      return errorResponse('승인할 수정안이 바뀌었거나 없습니다', 409)
    }
  } else if (!shouldWriteNote(state, body.action)) {
    return NextResponse.json({ ok: true, skipped: true })
  }
  const detail = body.action === 'approve' ? { id: body.id } : {}
  const note =
    body.action === 'approve'
      ? `autofix:approve id=${body.id} sha=${body.sha} by=admin`
      : `autofix:${body.action}`

  // 감사 기록이 먼저 — 기록에 실패하면 노트를 쓰지 않는다
  await writeAuditLog(auth.user.id, 'sentryIssue.autofix', 'sentryIssue', issueId, {
    action,
    ...detail,
    status: 'requested',
  })
  try {
    await addComment(issueId, note)
  } catch {
    await writeAuditLog(auth.user.id, 'sentryIssue.autofix', 'sentryIssue', issueId, {
      action,
      ...detail,
      status: 'failed',
    })
    return errorResponse('Sentry 노트 작성 실패', 502)
  }
  return NextResponse.json({ ok: true })
}
