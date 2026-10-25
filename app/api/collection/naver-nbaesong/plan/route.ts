/**
 * GET — 워커가 수집할 N배송 일정 + 그 스토어의 커머스API 키.
 * 복호화는 앱에서 한다 — 워커에 space-credential 키를 주면 같은 저장소의 다른 연동(검색광고·Meta·Google)까지 풀 수 있다.
 * Naver 호출은 IP가 등록된 워커에서만 한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptField } from '@/lib/crypto/field-crypto'
import {
  NAVER_COMMERCE_PROVIDER,
  type NaverCommerceConfig,
  type NaverCommerceSecret,
  type NaverCommerceStoreSecret,
} from '@/lib/naver-commerce/client'
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
      if (stores.length === 0) return []
      // 복호화 실패는 null 로 내려 워커가 그 스토어들의 finish 에 오류를 남기게 한다(원문은 로그에도 안 남긴다).
      let secrets: Record<string, NaverCommerceStoreSecret> | null = null
      try {
        const all = (
          JSON.parse(
            decryptField('space-credential', r.encryptedPayload, r.iv)
          ) as NaverCommerceSecret
        ).stores
        secrets = Object.fromEntries(
          stores.filter((s) => all?.[s.key]).map((s) => [s.key, all[s.key]])
        )
      } catch {
        console.error('[naver-nbaesong/plan] 자격증명 복호화 실패', r.spaceId)
      }
      return [{ spaceId: r.spaceId, credentialId: r.id, secrets, stores }]
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
