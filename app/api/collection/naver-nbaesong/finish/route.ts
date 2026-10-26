/**
 * POST — 워커의 한 스토어 수집 결과. 백필 커서를 전진시키고 오류를 기록·해소한다.
 * 연속 실패(직전 실행에도 오류가 남아 있음)면 Space 알림 채널로 1회 알리고, 그 스토어가 성공하면 복구를 알린다.
 * 알림 전이는 healthError·healthAlertedAt 으로 판단한다(credential-health 의 점검 대상이 아닌 공급자라 겹치지 않음).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { maskSecrets } from '@/lib/agent/audit'
import { recordCredentialError } from '@/lib/agent/integrations/space-credential'
import { escapeMrkdwn } from '@/lib/slack/mrkdwn'
import { sendSpaceNotification } from '@/lib/slack/send-notification'
import { advanceCursor } from '@/lib/naver-commerce/schedule'
import { loadNbaesongStore, resolveNbaesongScope } from '@/lib/naver-commerce/worker-api'

const ymd = z.iso.date()
const BodySchema = z.object({
  spaceId: z.string().min(1),
  storeKey: z.string().min(1),
  attempted: z.array(ymd).max(100),
  ok: z.array(ymd).max(100),
  error: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const resolved = await resolveNbaesongScope(request.headers)
  if ('error' in resolved) return resolved.error
  const { scope } = resolved
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const { spaceId, storeKey, attempted, ok, error } = parsed.data

  const found = await loadNbaesongStore(scope, spaceId, storeKey)
  if (found.error) return found.error
  const { credentialId, config, store, alert } = found

  const backfilledThrough = advanceCursor(
    store.backfilledThrough,
    store.startDate,
    attempted,
    new Set(ok)
  )
  await prisma.spaceCredential.update({
    where: { id: credentialId },
    data: {
      config: {
        ...config,
        stores: config.stores.map((s) => (s.key === storeKey ? { ...s, backfilledThrough } : s)),
      },
    },
  })
  // lastError 는 자격증명(스토어 공용) 1칸 — 스토어 접두어로 구분해 다른 스토어 성공이 지우지 않게 한다.
  const prefix = `[${storeKey}] `
  if (error) {
    await recordCredentialError(credentialId, prefix + error)
    // 한 번의 일시 오류(429·네트워크)는 다음 시각 재수집으로 풀리므로, 직전 실행도 실패했을 때만 알린다.
    // 직전 오류는 어느 스토어 것이든 본다 — 두 스토어가 함께 실패하면 lastError 가 번갈아 덮이기 때문.
    if (alert.lastError && !alert.healthAlertedAt) {
      const sent = await sendSpaceNotification({
        spaceId,
        text: `:warning: 스마트스토어 N배송 판매 수집이 연속 실패했습니다 (${escapeMrkdwn(store.label)}): ${escapeMrkdwn(maskSecrets(error).slice(0, 300))}\n복구될 때까지 N배송 판매·재고 차감이 반영되지 않습니다.`,
      })
      if (sent)
        await prisma.spaceCredential.update({
          where: { id: credentialId },
          data: { healthError: prefix + maskSecrets(error).slice(0, 480), healthAlertedAt: new Date() },
        })
    }
  } else {
    await prisma.spaceCredential.updateMany({
      where: { id: credentialId, lastError: { startsWith: prefix } },
      data: { lastError: null },
    })
    if (alert.healthAlertedAt && alert.healthError?.startsWith(prefix)) {
      await sendSpaceNotification({
        spaceId,
        text: `:white_check_mark: 스마트스토어 N배송 판매 수집이 복구되었습니다 (${escapeMrkdwn(store.label)}). 밀린 날짜는 다음 수집에서 다시 반영됩니다.`,
      })
      await prisma.spaceCredential.update({
        where: { id: credentialId },
        data: { healthError: null, healthAlertedAt: null },
      })
    }
  }
  return NextResponse.json({ backfilledThrough })
}
