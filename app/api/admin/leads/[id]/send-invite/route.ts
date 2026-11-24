import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email/send'
import { findSignupLead, leadSignupUrl, markLeadsContacted } from '@/lib/marketing/lead-signup'
import {
  LEAD_INVITE_TITLE,
  leadInviteText,
  renderLeadInviteEmail,
} from '@/lib/marketing/lead-invite-content'
import { leadInviteSchema } from '@/lib/validations/lead-invite'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const parsed = leadInviteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('메시지는 300자 이내로 입력해 주세요', 400)
  const { id } = await params
  const lead = await prisma.marketingLead.findUnique({ where: { id } })
  if (!lead) return errorResponse('도입 신청을 찾을 수 없습니다', 404)
  if (lead.status === 'DROPPED')
    return errorResponse('종료된 신청에는 안내 메일을 보낼 수 없습니다', 409)

  const email = lead.email.trim().toLowerCase()
  // 같은 주소의 중복 신청도 동일한 링크를 쓴다. 동일 메시지 재시도 시 Resend 본문 충돌을 막는다.
  const firstLead = await findSignupLead(email)
  if (!firstLead) return errorResponse('종료된 신청에는 안내 메일을 보낼 수 없습니다', 409)
  let signupUrl: string
  try {
    signupUrl = leadSignupUrl(firstLead.id, '/my-deck')
  } catch {
    return errorResponse('가입 링크를 만들 수 없습니다. 잠시 후 다시 시도해 주세요', 503)
  }
  const message = parsed.data.message
  const now = new Date()
  const date = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const dayStart = new Date(`${date}T00:00:00+09:00`)
  // 같은 날 이미 남은 발송 이력은 수신자·최초 운영자·발송 시간을 그대로 보존한다.
  if (firstLead.invitedAt && firstLead.invitedAt >= dayStart) {
    return NextResponse.json({ ok: true, alreadySent: true })
  }
  const recipientHash = createHash('sha256').update(email).digest('hex')
  try {
    const sent = await sendEmail({
      from: process.env.LEAD_NOTIFY_FROM ?? 'Workdeck <noreply@workdeck.work>',
      to: email,
      replyTo: process.env.LEAD_NOTIFY_TO ?? 'hello@workdeck.work',
      subject: `[워크덱] ${LEAD_INVITE_TITLE}`,
      html: renderLeadInviteEmail(message, signupUrl),
      text: leadInviteText(message, signupUrl),
      idempotencyKey: `lead-invite:${recipientHash}:${date}`,
    })
    if (!sent) return errorResponse('메일 발송 설정을 확인해 주세요. 발송되지 않았습니다', 503)
  } catch (error) {
    if (error instanceof Error && error.message === 'resend 409') {
      return errorResponse(
        '같은 날 이 이메일로 보낸 메일과 내용이 다릅니다. 메시지를 바꾸어 다시 보낼 수 없습니다. 저장 실패 재시도라면 처음과 같은 메시지로 보내 주세요',
        409
      )
    }
    return errorResponse('안내 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요', 502)
  }

  try {
    const recorded = await prisma.$transaction(async (tx) => {
      // 동시 요청은 canonical 행의 조건부 갱신을 얻은 한 요청만 기록한다.
      // 뒤의 상태·감사 저장이 실패하면 이 claim도 롤백되어 동일 본문 재시도로 복구된다.
      const claimed = await tx.marketingLead.updateMany({
        where: { id: firstLead.id, OR: [{ invitedAt: null }, { invitedAt: { lt: dayStart } }] },
        data: { invitedAt: now, invitedBy: auth.user.id },
      })
      if (claimed.count !== 1) return false
      await markLeadsContacted(email, tx)
      // 전환·종료 상태를 낮추지 않고, 같은 수신 주소의 발송 이력을 함께 표시한다.
      await tx.marketingLead.updateMany({
        where: { email: { equals: email, mode: 'insensitive' }, status: { not: 'DROPPED' } },
        data: { invitedAt: now, invitedBy: auth.user.id },
      })
      await writeAuditLog(
        auth.user.id,
        'marketingLead.sendInvite',
        'marketingLead',
        id,
        undefined,
        tx
      )
      return true
    })
    if (!recorded) return NextResponse.json({ ok: true, alreadySent: true })
  } catch {
    return errorResponse(
      '메일은 나갔을 수 있습니다. 기록 저장에 실패했습니다. 처음과 같은 메시지로 다시 눌러도 같은 날은 중복 발송되지 않습니다',
      500
    )
  }
  return NextResponse.json({ ok: true })
}
