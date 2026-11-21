import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { addComment, isSentryApiConfigured, listComments } from '@/lib/sentry/api'
import { parseAutofixState, shouldWriteNote } from '@/lib/sentry/autofix-status'

const bodySchema = z.object({ action: z.enum(['request', 'skip']) })

// POST /api/admin/errors/[issueId] — Sentry 이슈에 자동 수정 요청/제외 노트를 남긴다
export async function POST(request: Request, { params }: { params: Promise<{ issueId: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { issueId } = await params
  if (!/^\d+$/.test(issueId)) return errorResponse('잘못된 요청입니다', 400)
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('잘못된 요청입니다', 400)
  if (!isSentryApiConfigured()) return errorResponse('Sentry API 가 설정되지 않았습니다', 503)

  const { action } = parsed.data
  let state
  try {
    state = parseAutofixState(await listComments(issueId))
  } catch {
    return errorResponse('Sentry 노트 조회 실패', 502)
  }
  if (!shouldWriteNote(state, action)) return NextResponse.json({ ok: true, skipped: true })

  // 감사 기록이 먼저 — 기록에 실패하면 노트를 쓰지 않는다
  await writeAuditLog(auth.user.id, 'sentryIssue.autofix', 'sentryIssue', issueId, {
    action,
    status: 'requested',
  })
  try {
    await addComment(issueId, `autofix:${action}`)
  } catch {
    await writeAuditLog(auth.user.id, 'sentryIssue.autofix', 'sentryIssue', issueId, {
      action,
      status: 'failed',
    })
    return errorResponse('Sentry 노트 작성 실패', 502)
  }
  return NextResponse.json({ ok: true })
}
