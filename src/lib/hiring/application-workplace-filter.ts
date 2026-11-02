import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

export function normalizeWorkplaceFilter(value: string | undefined): string {
  return value?.trim().slice(0, 200) ?? ''
}

export async function applicantWorkplaceWhere(
  spaceId: string,
  store: string,
  position: string,
  postingId?: string
): Promise<Prisma.HiringApplicationWhereInput> {
  const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')
  const positions = position
    ? await prisma.hiringPostingPosition.findMany({
        where: {
          spaceId,
          ...(postingId ? { postingId } : {}),
          name: { contains: escapeLike(position), mode: 'insensitive' },
        },
        select: { id: true, postingId: true },
      })
    : []
  if (position && positions.length === 0) return { id: { in: [] } }
  const byPosting = new Map<string, string[]>()
  for (const item of positions) {
    const ids = byPosting.get(item.postingId) ?? []
    ids.push(item.id)
    byPosting.set(item.postingId, ids)
  }
  // ponytail: 일치한 직무 수만큼 쿼리 조건이 늘어난다. 대규모 고객은 DB 상관 조건으로 전환한다.
  return {
    ...(store
      ? {
          stores: {
            some: {
              store: { spaceId, name: { contains: escapeLike(store), mode: 'insensitive' } },
            },
          },
        }
      : {}),
    ...(position
      ? {
          AND: [
            {
              OR: Array.from(byPosting, ([postingId, ids]) => ({
                postingId,
                postingPositionId: { in: ids },
              })),
            },
          ],
        }
      : {}),
  }
}
