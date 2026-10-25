/**
 * GET — 워커가 수집할 N배송 일정. 비밀값은 암호문 그대로 내려가고 워커가 자체 키로 복호화한다.
 * Naver 호출은 IP가 등록된 워커에서만 한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { NAVER_COMMERCE_PROVIDER, type NaverCommerceConfig } from '@/lib/naver-commerce/client'
import { kstDay } from '@/lib/naver-commerce/nbaesong'
import { daysToSync } from '@/lib/naver-commerce/schedule'
import { resolveNbaesongScope } from '@/lib/naver-commerce/worker-api'

export async function GET(request: NextRequest) {
  const resolved = await resolveNbaesongScope(request.headers)
  if ('error' in resolved) return resolved.error
  const { scope } = resolved

  const rows = await prisma.spaceCredential.findMany({
    where: {
      provider: NAVER_COMMERCE_PROVIDER,
      ...(scope.spaceId ? { spaceId: scope.spaceId } : {}),
    },
    select: { id: true, spaceId: true, encryptedPayload: true, iv: true, config: true },
  })
  const today = kstDay(new Date().toISOString())
  const items = rows.flatMap((r) => {
    try {
      const stores = ((r.config as NaverCommerceConfig | null)?.stores ?? [])
        .map((s) => ({ key: s.key, days: daysToSync(today, s) }))
        .filter((s) => s.days.length > 0)
      return stores.length === 0
        ? []
        : [
            {
              spaceId: r.spaceId,
              credentialId: r.id,
              encryptedPayload: r.encryptedPayload,
              iv: r.iv,
              stores,
            },
          ]
    } catch (err) {
      // 한 행의 손상된 config 가 전체 응답을 막지 않게 건너뛴다.
      console.error(
        '[naver-nbaesong/plan] 일정 계산 실패',
        r.spaceId,
        err instanceof Error ? err.message : err
      )
      return []
    }
  })
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}
