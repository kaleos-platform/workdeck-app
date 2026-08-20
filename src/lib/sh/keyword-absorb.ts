import { prisma } from '@/lib/prisma'
import { keywordKeys } from '@/lib/sh/keyword-normalize'

/**
 * 리스팅 저장 시 채널에 등록된 검색어를 키워드 마스터로 흡수한다 (개편 설계 Phase 3).
 *
 * ⚠️ **서버 전용.** prisma 를 직접 쓴다 — 라우트 핸들러에서만 import 할 것.
 *
 * D1 "단방향 축적": 채널에 나가는 값의 권위는 여전히 ProductListing.keywords 이고,
 * 마스터는 그 값을 뒤따라 쌓기만 한다. 역방향 동기화도, 삭제 전파도 없다.
 */

export type AbsorbPlanItem = {
  keyword: string
  normalized: string
  despaced: string
  sortedKey: string
}

/** Json 컬럼(unknown)에서 흡수 대상 키워드를 뽑아 normalized 기준으로 중복을 접는다. */
export function planAbsorb(raw: unknown): AbsorbPlanItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: AbsorbPlanItem[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const keyword = entry.trim()
    if (!keyword) continue
    const keys = keywordKeys(keyword)
    if (!keys.normalized || seen.has(keys.normalized)) continue
    seen.add(keys.normalized)
    out.push({ keyword, ...keys })
  }
  return out
}

export type AbsorbTarget = {
  spaceId: string
  keywords: unknown
  productId: string | null
  listingId: string | null
}

/**
 * 흡수 본체. **절대 throw 하지 않는다** — 저장은 이미 커밋됐고, 부가 기능인 흡수가
 * 실패했다고 사용자에게 에러를 돌려주면 안 된다.
 */
export async function absorbKeywords(target: AbsorbTarget): Promise<void> {
  try {
    const items = planAbsorb(target.keywords)
    if (items.length === 0) return
    if (!target.productId && !target.listingId) return // 귀속 대상 없음 — 링크를 만들 수 없다

    // 조회·생성은 각각 1회로 묶는다. 리스팅당 최대 30개라 개별 왕복은 낭비다.
    const existing = await prisma.keywordMaster.findMany({
      where: { spaceId: target.spaceId, normalized: { in: items.map((i) => i.normalized) } },
      select: { id: true, normalized: true },
    })
    const idByNormalized = new Map(existing.map((r) => [r.normalized, r.id]))

    const missing = items.filter((i) => !idByNormalized.has(i.normalized))
    if (missing.length > 0) {
      // skipDuplicates: 동시 저장 경합에서 P2002 로 죽지 않게 한다.
      await prisma.keywordMaster.createMany({
        data: missing.map((i) => ({
          spaceId: target.spaceId,
          keyword: i.keyword,
          normalized: i.normalized,
          despaced: i.despaced,
          sortedKey: i.sortedKey,
          // R1: 채널에 실제 등록된 검색어이므로 미검증 후보가 아니다.
          source: 'INTERNAL' as const,
          status: 'SEARCH_TERM' as const,
        })),
        skipDuplicates: true,
      })
      // createMany 는 생성 행을 돌려주지 않는다 — 경합으로 건너뛴 행까지 포함해 다시 읽는다.
      const created = await prisma.keywordMaster.findMany({
        where: { spaceId: target.spaceId, normalized: { in: missing.map((i) => i.normalized) } },
        select: { id: true, normalized: true },
      })
      for (const r of created) idByNormalized.set(r.normalized, r.id)
    }

    // 링크도 배치로 만든다. 키워드마다 findFirst+create 를 돌면 30개에 60회 왕복이고,
    // 이 호출은 저장 응답 앞에 있어서 사용자가 그 지연을 그대로 기다린다.
    // @@unique([keywordId, productId, listingId]) 는 NULL 열을 제약하지 못하므로
    // createMany 의 skipDuplicates 에만 기대지 않고, 있는 링크를 먼저 읽어 뺀다.
    const keywordIds = items
      .map((i) => idByNormalized.get(i.normalized))
      .filter((id): id is string => Boolean(id))
    if (keywordIds.length === 0) return

    const existingLinks = await prisma.keywordMasterLink.findMany({
      where: {
        keywordId: { in: keywordIds },
        // 명시적 null — undefined 로 두면 "필터 없음"이 되어 다른 대상의 링크까지 잡는다.
        productId: target.productId,
        listingId: target.listingId,
      },
      select: { keywordId: true },
    })
    const linked = new Set(existingLinks.map((l) => l.keywordId))
    const newLinks = keywordIds.filter((id) => !linked.has(id))
    if (newLinks.length > 0) {
      await prisma.keywordMasterLink.createMany({
        data: newLinks.map((keywordId) => ({
          keywordId,
          productId: target.productId,
          listingId: target.listingId,
        })),
        skipDuplicates: true,
      })
    }
  } catch (e) {
    // R3 계약: 흡수 실패는 저장을 되돌리지 않는다. 로깅만 하고 삼킨다.
    console.error('[keyword-absorb] 흡수 실패', e)
  }
}
