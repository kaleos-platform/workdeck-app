import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * 현재 Space의 옵션 값-코드 커스텀 사전을 반환한다.
 * 옵션 속성 에디터가 마운트 시 1회 호출해 클라이언트 Map으로 캐시한다.
 * 자동 학습(upsert)은 상품 POST/PATCH 흐름에서 일어나며, 이 API는 읽기 전용이다.
 */
export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const aliases = await prisma.spaceOptionCodeAlias.findMany({
    where: { spaceId: resolved.space.id },
    select: { attributeName: true, value: true, code: true, updatedAt: true },
    orderBy: [{ attributeName: 'asc' }, { value: 'asc' }],
  })

  return NextResponse.json({ data: aliases })
}
