// 공고 메일 알림 설정 — 모집 조건이 아니므로 발행 후 잠금(publication-policy)과 무관하게 바꿀 수 있다.
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { postingMailSettingsSchema } from '@/lib/validations/hiring-posts'
import { getPostingMailSettings } from '@/lib/hiring/mail-settings'

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const { id } = await params
  const parsed = postingMailSettingsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('잘못된 요청 형식입니다', 400)
  const { notificationEnabled, applicantReceiptEmail } = parsed.data

  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)

  // 공고 행은 쓰지 않는다 — 이관 원장 해시(updatedAt·notificationEnabled 포함)가 깨지면 지원서 이관이 막힌다.
  const data = {
    ...(applicantReceiptEmail !== undefined && { applicantReceiptEmail }),
    ...(notificationEnabled !== undefined && { dailyDigestEmail: notificationEnabled }),
  }
  await prisma.hiringPostingMailSetting.upsert({
    where: { postingId: id },
    create: { postingId: id, ...data },
    update: data,
  })
  return NextResponse.json(await getPostingMailSettings(id))
}
