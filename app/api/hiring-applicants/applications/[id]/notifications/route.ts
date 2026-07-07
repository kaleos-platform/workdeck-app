// 지원 상태 알림 발송(공개열람 링크 생성) — 쓰기 권한 + spaceId 스코프.
// 원문 토큰은 URL 에만 실리고 DB 에는 HMAC 해시만 저장. 만료 +30일. SMS/알림톡 미연동(수동 복사).
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { generateNotificationToken } from '@/lib/hiring/pii'
import { notificationSchema } from '@/lib/validations/hiring-applicants'

type Params = { params: Promise<{ id: string }> }

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = notificationSchema.safeParse(body)
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)

  const app = await prisma.hiringApplication.findFirst({
    where: { id, spaceId: resolved.space.id, deletedAt: null },
    select: { id: true },
  })
  if (!app) return errorResponse('지원서를 찾을 수 없습니다', 404)

  const { token, tokenHash } = generateNotificationToken()
  const uuid = randomUUID()

  await prisma.hiringApplicationNotification.create({
    data: {
      spaceId: resolved.space.id,
      applicationId: id,
      senderUserId: resolved.user.id,
      notiType: parsed.data.notiType,
      detailMessage: parsed.data.detailMessage ?? null,
      uuid,
      tokenHash,
      tokenExpireAt: new Date(Date.now() + THIRTY_DAYS_MS),
      sentAt: new Date(),
    },
  })

  // 공개 열람 URL (수동 전달용). 원문 토큰은 여기서만 반환된다.
  const statusUrl = `/appl-status/${uuid}?token=${token}`
  return NextResponse.json({ ok: true, statusUrl }, { status: 201 })
}
