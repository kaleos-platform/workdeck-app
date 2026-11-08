import type { Prisma } from '@/generated/prisma/client'
import { isHiringDeadlinePassed } from './closing-date'

export class PostingClosedError extends Error {}

export async function lockOpenPosting(tx: Prisma.TransactionClient, id: string, spaceId: string) {
  // 공고 삭제가 세션을 변경하므로 공고를 세션보다 먼저 잠근다.
  const rows = await tx.$queryRaw<{ status: string; closingDate: Date | null }[]>`
    SELECT "status", "closingDate" FROM "HiringPosting"
    WHERE "id" = ${id} AND "spaceId" = ${spaceId} FOR UPDATE
  `
  const posting = rows[0]
  if (!posting || posting.status !== 'ACTIVE' || isHiringDeadlinePassed(posting.closingDate)) {
    throw new PostingClosedError()
  }
}
