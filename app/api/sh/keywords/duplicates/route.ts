import { NextResponse } from 'next/server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * 중복 클러스터 — §11 띄어쓰기 변형("호텔 타월" vs "호텔타월"), §12 단어 순서 순열.
 *
 * normalized 는 @@unique 라 완전 동일은 애초에 존재할 수 없다. 따라서 탐지 대상은
 * despaced/sortedKey 가 같은데 표기만 다른 조합이다.
 *
 * space 당 키워드 수가 작아 한 번의 findMany 로 읽고 메모리에서 묶는다
 * (groupBy+having 후 재조회보다 어긋날 여지가 적다).
 */

type Member = {
  id: string
  keyword: string
  status: string
  score: number
}

type Cluster = {
  kind: 'DESPACED' | 'SORTED'
  key: string
  members: Member[]
}

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const rows = await prisma.keywordMaster.findMany({
    where: { spaceId: resolved.space.id },
    select: { id: true, keyword: true, status: true, score: true, despaced: true, sortedKey: true },
    orderBy: { keyword: 'asc' },
  })

  function group(kind: Cluster['kind'], pick: (r: (typeof rows)[number]) => string): Cluster[] {
    const buckets = new Map<string, Member[]>()
    for (const r of rows) {
      const key = pick(r)
      if (!key) continue
      const list = buckets.get(key)
      const member: Member = { id: r.id, keyword: r.keyword, status: r.status, score: r.score }
      if (list) list.push(member)
      else buckets.set(key, [member])
    }
    return Array.from(buckets.entries())
      .filter(([, members]) => members.length > 1)
      .map(([key, members]) => ({ kind, key, members }))
  }

  const clusters = [...group('DESPACED', (r) => r.despaced), ...group('SORTED', (r) => r.sortedKey)]

  // 같은 구성원 집합이 두 축에서 모두 잡히면 한 번만 보고한다(같은 사실을 두 줄로 알리지 않음).
  const seen = new Set<string>()
  const deduped: Cluster[] = []
  for (const c of clusters) {
    const signature = c.members
      .map((m) => m.id)
      .sort()
      .join('|')
    if (seen.has(signature)) continue
    seen.add(signature)
    deduped.push(c)
  }

  deduped.sort((a, b) => b.members.length - a.members.length)

  return NextResponse.json({ clusters: deduped, total: deduped.length })
}
