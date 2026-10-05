import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { errorResponse } from '@/lib/api-helpers'
import { PUBLISHED_POSTING_LOCK_MESSAGE } from './publication-policy'

// 발행과 모집 설정 변경이 같은 공고 행 잠금을 공유한다.
// publishedAt=null을 유지하는 조건부 UPDATE로 잠근 뒤 모든 변경을 같은 트랜잭션에서 처리한다.
export async function withUnpublishedPosting(
  spaceId: string,
  id: string,
  write: (tx: Prisma.TransactionClient) => Promise<Response>
): Promise<Response> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.hiringPosting.updateMany({
      where: { id, spaceId, status: 'DRAFT', publishedAt: null },
      data: { publishedAt: null },
    })
    if (locked.count !== 1) return errorResponse(PUBLISHED_POSTING_LOCK_MESSAGE, 409)
    return write(tx)
  })
}
