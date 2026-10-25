// 워커용 N배송 수집 API 공통: 워커 인증 → space 범위, 스토어 자격증명 조회.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { authenticateWorker } from '@/lib/worker-auth'
import { NAVER_COMMERCE_PROVIDER, type NaverCommerceConfig } from './client'

/**
 * space 토큰만 받는다. plan 이 커머스API 키를 평문으로 내려주므로 legacy 키(전 space)를 받으면
 * 그 키 하나로 모든 space 의 키가 열린다(#1203).
 */
export async function resolveNbaesongScope(
  headers: Headers
): Promise<{ scope: { spaceId: string } } | { error: NextResponse }> {
  const auth = await authenticateWorker(headers)
  if ('error' in auth) return { error: auth.error }
  if (auth.scope.kind !== 'space')
    return { error: errorResponse('N배송 수집은 Space 워커 토큰이 필요합니다', 403) }
  return { scope: { spaceId: auth.scope.spaceId } }
}

/** 범위·자격증명·스토어를 확인한다. 실패 시 응답을 돌려준다. */
export async function loadNbaesongStore(
  scope: { spaceId?: string },
  spaceId: string,
  storeKey: string
) {
  if (scope.spaceId && scope.spaceId !== spaceId)
    return { error: errorResponse('다른 공간의 자원에 접근할 수 없습니다', 403) }
  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider: NAVER_COMMERCE_PROVIDER } },
    select: { id: true, config: true },
  })
  const config = row?.config as NaverCommerceConfig | null | undefined
  const store = config?.stores?.find((s) => s.key === storeKey)
  if (!row || !config || !store) return { error: errorResponse('스토어 자격증명이 없습니다', 404) }
  return { credentialId: row.id, config, store }
}
