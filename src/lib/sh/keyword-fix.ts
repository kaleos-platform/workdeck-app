// 상품명 자동 수정 — 위반을 사람이 직접 고치지 않아도 되게 하는 순수 함수.
// (서버·클라이언트 양쪽에서 import 하므로 prisma 등 서버 전용 모듈을 끌어오지 않는다)

import type { KeywordRuleSet } from './keyword-rules'
import type { Violation } from './keyword-validate'

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collapse(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** 지정한 표현을 상품명에서 모두 지운다(띄어쓴 회피형도 함께). */
export function removeTerm(name: string, term: string): string {
  const variants = [term, term.replace(/\s+/g, '')].filter((v) => v.length > 0)
  let next = name
  for (const variant of new Set(variants)) {
    next = next.replace(new RegExp(escapeRegExp(variant), 'gi'), ' ')
  }
  return collapse(next)
}

/** 반복된 단어의 두 번째 이후 등장만 지운다(첫 등장은 남긴다). */
export function removeRepeatedToken(name: string, token: string): string {
  const target = token.toLowerCase()
  let seen = false
  const kept = name.split(/\s+/).filter((word) => {
    if (word.toLowerCase() !== target) return true
    if (seen) return false
    seen = true
    return true
  })
  return collapse(kept.join(' '))
}

/** §8.4 장식용 특수문자 제거. 공유 RegExp 는 상태를 갖지 않도록 source 로 새로 만든다. */
export function removeDecorativeChars(name: string, rules: KeywordRuleSet): string {
  return collapse(name.replace(new RegExp(rules.specialCharPattern.source, 'g'), ' '))
}

/**
 * 위반 하나를 자동으로 고친 이름을 돌려준다. 자동 수정이 불가하면 null.
 *
 * 길이·중복 같은 위반은 사람이 무엇을 남길지 정해야 하므로 자동 수정 대상이 아니다.
 * 특수문자는 장식 문자가 실제로 있을 때만 — 개수 초과 경고는 어떤 문자를 남길지 사람이 고른다.
 */
export function fixForViolation(
  name: string,
  violation: Violation,
  rules: KeywordRuleSet
): string | null {
  if (violation.code === 'NAME_REPEATED_TOKEN' && violation.conflictWith) {
    return removeRepeatedToken(name, violation.conflictWith)
  }
  if (
    (violation.code === 'NAME_PROMO_TERM' ||
      violation.code === 'NAME_SELLER_TERM' ||
      violation.code === 'NAME_COMPETITOR_BRAND') &&
    violation.conflictWith
  ) {
    return removeTerm(name, violation.conflictWith)
  }
  if (violation.code === 'NAME_SPECIAL_CHARS' && rules.specialCharPattern.test(name)) {
    return removeDecorativeChars(name, rules)
  }
  return null
}
