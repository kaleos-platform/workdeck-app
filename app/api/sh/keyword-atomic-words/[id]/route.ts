import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  // spaceId 를 함께 걸어 다른 Space 의 사전을 지우지 못하게 한다.
  const { count } = await prisma.spaceAtomicWord.deleteMany({
    where: { id, spaceId: resolved.space.id },
  })
  if (count === 0) return errorResponse('예외 단어를 찾을 수 없습니다', 404)

  return NextResponse.json({ ok: true })
}
