// 저장 응답에 동봉하는 상품명·검색어 경고.
//
// ⚠️ 저장을 막지 않는다. ERROR 등급이 나와도 정보 전달용이고, 이 함수가 던지더라도
// 이미 끝난 저장에 영향을 주면 안 된다. 그래서 항상 저장 **성공 이후**에 호출하고,
// 실패는 null 로 접어 응답에서 필드를 생략한다.

import { validateListingNaming, type ListingNamingResult } from './keyword-validate'
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
    const rules = await loadKeywordRules(spaceId, channelId)
    const keywords = Array.isArray(input.keywords)
      ? input.keywords.filter((k): k is string => typeof k === 'string')
      : []
    return validateListingNaming({
      searchName: input.searchName ?? '',
      displayName: input.displayName ?? undefined,
      keywords,
      optionNames: input.optionNames,
      rules,
    })
  } catch (e) {
    console.warn('[buildNamingWarnings] 검증 실패 — 경고 없이 응답합니다', e)
    return null
  }
}
