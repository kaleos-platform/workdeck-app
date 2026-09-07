// 저장 응답에 동봉하는 상품명·검색어 경고.
//
// ⚠️ 저장을 막지 않는다. ERROR 등급이 나와도 정보 전달용이고, 이 함수가 던지더라도
// 이미 끝난 저장에 영향을 주면 안 된다. 그래서 항상 저장 **성공 이후**에 호출하고,
// 실패는 null 로 접어 응답에서 필드를 생략한다.

import { prisma } from '@/lib/prisma'
import { validateListingNaming, type ListingNamingResult } from './keyword-validate'
import { loadAtomicWords } from './keyword-atomic-query'
import { loadKeywordRules } from './keyword-rules-query'

export async function buildNamingWarnings(
  spaceId: string,
  channelId: string | null | undefined,
  input: {
    searchName: string
    displayName?: string | null
    keywords: unknown
    optionNames?: string[]
  }
): Promise<ListingNamingResult | null> {
  try {
    // 브랜드명·예외 단어를 넘기지 않으면 저장 경고가 에디터 판정과 갈린다
    // (에디터는 둘 다 반영한다 — 같은 검색어를 놓고 서로 다른 말을 하게 된다).
    const [rules, atomicWords, brands] = await Promise.all([
      loadKeywordRules(spaceId, channelId),
      loadAtomicWords(spaceId),
      prisma.brand.findMany({ where: { spaceId }, select: { name: true } }),
    ])
    const keywords = Array.isArray(input.keywords)
      ? input.keywords.filter((k): k is string => typeof k === 'string')
      : []
    return validateListingNaming({
      searchName: input.searchName ?? '',
      displayName: input.displayName ?? undefined,
      keywords,
      optionNames: input.optionNames,
      brandNames: brands.map((b) => b.name),
      atomicWords,
      rules,
    })
  } catch (e) {
    console.warn('[buildNamingWarnings] 검증 실패 — 경고 없이 응답합니다', e)
    return null
  }
}
