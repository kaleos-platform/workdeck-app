// 도입 신청(리드) 공개 API — 무인증. 허니팟·레이트리밋·중복 방어, 연락처는 암호화 저장.
import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { checkRateLimit } from '@/lib/hiring/applications'
import { publicRequestKey } from '@/lib/hiring/public-request'
import { encryptPii } from '@/lib/del/encryption'
import { DECK_META } from '@/lib/deck-meta'
import { MARKETING_DECK_SLUGS } from '@/lib/marketing/routes'
import { notifyEmail, notifySlack } from '@/lib/marketing/lead-notify'
import { employeeCountLabel, marketingLeadRequestSchema } from '@/lib/validations/marketing-lead'

export const runtime = 'nodejs'

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000
const NOTIFY_HOURLY_LIMIT = 30

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`lead:${publicRequestKey(req)}`)) {
    return errorResponse('요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요', 429)
  }

  if (!req.headers.get('content-type')?.includes('application/json')) {
    return errorResponse('Content-Type 은 application/json 이어야 합니다', 415)
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return errorResponse('잘못된 요청입니다', 400)

  // 허니팟 — 봇은 성공으로 보이게 두고 저장하지 않는다
  if (typeof body.hp_extra === 'string' && body.hp_extra.length > 0) {
    return NextResponse.json({ ok: true })
  }

  const parsed = marketingLeadRequestSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력한 정보를 확인해 주세요', 400, {
      fieldErrors: parsed.error.flatten().fieldErrors,
    })
  }
  const { name, email, companyName, position, employeeCount, phone, deck, utm, referrer } =
    parsed.data
  const fields = { name, email, companyName, position, employeeCount }
  if (!(MARKETING_DECK_SLUGS as readonly string[]).includes(deck)) {
    return errorResponse('잘못된 요청입니다', 400)
  }

  const duplicate = await prisma.marketingLead.findFirst({
    where: {
      email: fields.email,
      deck,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    },
    select: { id: true },
  })
  if (duplicate) return NextResponse.json({ ok: true }, { status: 201 })

  const enc = encryptPii(phone)
  await prisma.marketingLead.create({
    data: {
      ...fields,
      deck,
      phoneEnc: enc.encrypted,
      phoneIv: enc.iv,
      consentAt: new Date(),
      utm: utm as Prisma.InputJsonValue | undefined,
      referrer,
    },
  })

  // 스팸 폭주 시 알림 채널을 보호한다 — 저장은 유지하고 알림만 건너뛴다
  const recentCount = await prisma.marketingLead.count({
    where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  })
  if (recentCount > NOTIFY_HOURLY_LIMIT) {
    console.warn('[leads] 최근 1시간 접수 과다 — 알림 생략:', recentCount)
    return NextResponse.json({ ok: true }, { status: 201 })
  }

  const notify = {
    ...fields,
    employeeCount: employeeCountLabel(fields.employeeCount),
    deck,
    deckName: DECK_META[deck as keyof typeof DECK_META].name,
    phone,
  }
  const results = await Promise.allSettled([notifySlack(notify), notifyEmail(notify)])
  for (const r of results) {
    // 개인정보가 섞이지 않도록 메시지만 남긴다
    if (r.status === 'rejected') console.error('[leads] 알림 실패:', (r.reason as Error)?.message)
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
