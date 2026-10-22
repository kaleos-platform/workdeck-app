// 순위 추적 대상 키("cp:<id>" | "ls:<id>") 해석 + Space 소유 검증.

import { prisma } from '@/lib/prisma'

export type RankTarget = { kind: 'channelProduct' | 'listing'; id: string }

export function parseTargetKey(targetKey: string | null): RankTarget | null {
  const m = targetKey?.match(/^(cp|ls):([A-Za-z0-9_-]{1,64})$/)
  if (!m) return null
  return { kind: m[1] === 'cp' ? 'channelProduct' : 'listing', id: m[2] }
}

/** 형식이 올바르고 해당 Space 소유일 때만 대상을 돌려준다. */
export async function resolveRankTarget(spaceId: string, targetKey: string | null) {
  const t = parseTargetKey(targetKey)
  if (!t) return null
  const where = { id: t.id, spaceId }
  const row =
    t.kind === 'channelProduct'
      ? await prisma.channelProduct.findFirst({ where, select: { id: true } })
      : await prisma.productListing.findFirst({
          where,
          select: { id: true, channelProductId: true },
        })
  return row ? t : null
}

export const ymdOf = (d: Date) => d.toISOString().slice(0, 10) // @db.Date 는 UTC 자정으로 읽힌다
