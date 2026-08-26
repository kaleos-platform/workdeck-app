# 폼 검증 노출 + 길이 기준 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매채널 상품 등록/수정 화면에서 상품명 위반을 입력란 옆에 보여주고 원클릭으로 고칠 수 있게 하며, 세 갈래로 충돌하던 길이 기준을 채널 기준 하나로 합친다.

**Architecture:** 검증 로직은 이미 순수 함수로 존재한다(`src/lib/sh/keyword-*.ts`). 이 계획은 **새 로직을 만들지 않고** ① SOP 위저드에만 있던 수정 함수를 공용 모듈로 추출하고 ② 계산되고도 버려지던 위반을 화면에 연결하며 ③ 길이 기준의 출처를 하나로 모은다.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, React 19, shadcn/ui(new-york), Tailwind v4, Jest.

**Spec:** `docs/decks/seller-hub/prd/keyword-ux-revamp.md` (Phase 1·2)

## Global Constraints

- 사용자 노출 문구는 전부 **한국어**. 코드·주석·커밋은 기존 스타일을 따른다.
- `src/lib/sh/keyword-*.ts`는 **prisma를 import하지 않는다** — 클라이언트 번들에 들어간다. 규칙은 서버가 로딩해 순수 함수에 주입한다.
- `src/lib/inv/search-tokens.ts`의 `MAX_TOKENS = 12` **기본값을 바꾸지 않는다**. `/api/sh/products`의 tokenized 검색이 의존한다.
- `src/lib/sh/schemas.ts`의 keywords `.max(30)`을 **낮추지 않는다**. 낮추면 기존 21~30개 보유 리스팅의 무관한 필드 PATCH까지 실패한다.
- 새 npm 패키지를 설치하지 않는다.
- 저장을 **차단하지 않는다**. 위반은 경고이며, `changeReason` 없이도 저장은 성공해야 한다.
- 연동 채널(`Channel.externalSource != null`)은 읽기전용 미러 — 편집 어포던스를 노출하지 않는다.
- 각 Task 끝에서 `npx jest`와 `npm run typecheck`가 통과해야 한다. 현재 기준선은 **856 테스트 통과**.

---

## File Structure

**신규**

- `src/lib/sh/keyword-fix.ts` — 상품명 자동 수정 순수 함수 3종 + 위반→수정 매핑. `step-05-clean-name.tsx`에서 추출.
- `src/lib/sh/__tests__/keyword-fix.test.ts`
- `src/components/sh/products/listings/name-validation-panel.tsx` — 상품명 입력란 하나에 대응하는 위반 표시 + 원클릭 수정.
- `src/components/sh/products/listings/name-counter.tsx` — 세 곳에 중복 정의된 `NameCounter` 통합본.

**수정**

- `src/lib/sh/keyword-rules.ts` — 채널 기본값 맵 흡수, `channelLimits`·`rulesForNameField` 추가, `resolveKeywordRules` 시그니처 변경.
- `src/lib/sh/keyword-validate.ts` — `validateListingNaming`에 `displayName` 추가, 반환 형태 변경.
- `src/lib/sh/keyword-warnings.ts` — 새 반환 형태 대응.
- `app/api/sh/keywords/validate/route.ts` — 새 반환 형태 대응.
- `src/components/sh/products/listings/steps/step-05-clean-name.tsx` — 추출한 함수를 import로 교체.
- `src/components/sh/products/listings/listing-form.tsx` — 패널 연결, SOP 링크는 이미 있음.
- `src/components/sh/products/listings/listing-create-form.tsx` — 패널 연결 + SOP 진입점 추가.
- `src/components/sh/products/listings/group-base-info-card.tsx` — `NameCounter` 통합본 사용.
- `src/components/sh/products/listings/keyword-editor.tsx` — 상품명 요약 제거(패널로 이동).

**삭제**

- `src/components/sh/products/listings/channel-name-limits.ts` — `keyword-rules.ts`로 흡수.

---

### Task 1: 상품명 자동 수정 함수 추출

지금 `removeTerm`·`removeRepeatedToken`·`removeDecorativeChars`가 `steps/step-05-clean-name.tsx`(SOP 위저드 전용 컴포넌트)에 있다. 폼에서도 써야 하므로 순수 모듈로 옮긴다. **동작은 한 글자도 바꾸지 않는다.**

**Files:**

- Create: `src/lib/sh/keyword-fix.ts`
- Create: `src/lib/sh/__tests__/keyword-fix.test.ts`
- Modify: `src/components/sh/products/listings/steps/step-05-clean-name.tsx:52-87` (함수 삭제 후 import)

**Interfaces:**

- Consumes: `KeywordRuleSet` from `@/lib/sh/keyword-rules`, `Violation` from `@/lib/sh/keyword-validate`
- Produces:
  - `removeTerm(name: string, term: string): string`
  - `removeRepeatedToken(name: string, token: string): string`
  - `removeDecorativeChars(name: string, rules: KeywordRuleSet): string`
  - `fixForViolation(name: string, violation: Violation, rules: KeywordRuleSet): string | null` — 자동 수정이 가능하면 수정된 이름, 불가하면 null

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sh/__tests__/keyword-fix.test.ts`:

```ts
import { DEFAULT_KEYWORD_RULES } from '../keyword-rules'
import {
  fixForViolation,
  removeDecorativeChars,
  removeRepeatedToken,
  removeTerm,
} from '../keyword-fix'

describe('removeTerm', () => {
  it('지정한 표현을 지운다', () => {
    expect(removeTerm('모노홈 무료배송 호텔 타월', '무료배송')).toBe('모노홈 호텔 타월')
  })

  it('띄어쓰기로 회피한 형태도 함께 지운다', () => {
    expect(removeTerm('모노홈 무료 배송 타월', '무료 배송')).toBe('모노홈 타월')
  })

  it('정규식 메타문자가 든 표현도 그대로 처리한다', () => {
    expect(removeTerm('타월 1+1 세트', '1+1')).toBe('타월 세트')
  })
})

describe('removeRepeatedToken', () => {
  it('두 번째 이후 등장만 지운다', () => {
    expect(removeRepeatedToken('여성 팬티 모달 팬티 속옷 팬티', '팬티')).toBe('여성 팬티 모달 속옷')
  })
})

describe('removeDecorativeChars', () => {
  it('장식 문자를 지우고 공백을 정리한다', () => {
    expect(removeDecorativeChars('★특가★ 호텔 타월', DEFAULT_KEYWORD_RULES)).toBe('특가 호텔 타월')
  })
})

describe('fixForViolation', () => {
  it('반복 토큰 위반이면 그 토큰을 정리한다', () => {
    const fixed = fixForViolation(
      '여성 팬티 모달 팬티',
      {
        code: 'NAME_REPEATED_TOKEN',
        severity: 'WARN',
        keywordIndex: null,
        message: '반복',
        conflictWith: '팬티',
      },
      DEFAULT_KEYWORD_RULES
    )
    expect(fixed).toBe('여성 팬티 모달')
  })

  it('conflictWith 가 없으면 자동 수정하지 않는다', () => {
    const fixed = fixForViolation(
      '타월',
      { code: 'NAME_PROMO_TERM', severity: 'WARN', keywordIndex: null, message: '프로모션' },
      DEFAULT_KEYWORD_RULES
    )
    expect(fixed).toBeNull()
  })

  it('장식 문자가 실제로 없으면 자동 수정하지 않는다', () => {
    const fixed = fixForViolation(
      '타월 (대형)',
      { code: 'NAME_SPECIAL_CHARS', severity: 'WARN', keywordIndex: null, message: '특수문자' },
      DEFAULT_KEYWORD_RULES
    )
    expect(fixed).toBeNull()
  })

  it('길이 위반은 자동 수정 대상이 아니다', () => {
    const fixed = fixForViolation(
      '짧은 이름',
      { code: 'NAME_BELOW_TARGET', severity: 'INFO', keywordIndex: null, message: '짧음' },
      DEFAULT_KEYWORD_RULES
    )
    expect(fixed).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/lib/sh/__tests__/keyword-fix.test.ts`
Expected: FAIL — `Cannot find module '../keyword-fix'`

- [ ] **Step 3: 모듈 작성**

`src/lib/sh/keyword-fix.ts`. `step-05-clean-name.tsx:52-87`의 본문을 **그대로** 옮긴다.

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/lib/sh/__tests__/keyword-fix.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: step-05에서 중복 제거**

`steps/step-05-clean-name.tsx`에서 `escapeRegExp`·`collapse`·`removeTerm`·`removeRepeatedToken`·`removeDecorativeChars` 정의(52-87행)를 삭제하고 import로 바꾼다. `fixFor` 함수 본문은 `fixForViolation` 호출로 교체한다:

```ts
import { fixForViolation } from '@/lib/sh/keyword-fix'

// 컴포넌트 안:
function fixFor(violation: Violation): (() => void) | null {
  const fixed = fixForViolation(name, violation, rules)
  if (fixed === null) return null
  return () => onNameChange(fixed)
}
```

⚠️ 다른 파일이 이 세 함수를 import하고 있지 않은지 확인: `grep -rn "removeTerm\|removeRepeatedToken\|removeDecorativeChars" src/ --include="*.tsx" --include="*.ts"` — `step-05-clean-name.tsx`와 새 모듈·테스트만 나와야 한다.

- [ ] **Step 6: 전체 검증**

Run: `npx jest && npm run typecheck`
Expected: 865 테스트 통과(856 + 신규 9), 타입에러 0

- [ ] **Step 7: 커밋**

```bash
git add src/lib/sh/keyword-fix.ts src/lib/sh/__tests__/keyword-fix.test.ts src/components/sh/products/listings/steps/step-05-clean-name.tsx
git commit -m "♻️ refactor(sh): 상품명 자동 수정 함수를 공용 모듈로 추출

SOP 위저드 전용 컴포넌트에 있던 removeTerm·removeRepeatedToken·
removeDecorativeChars 를 keyword-fix.ts 로 옮긴다. 등록/수정 폼에서도
같은 수정을 제공해야 하는데, 컴포넌트 안에 있으면 재사용할 수 없다.

위반 하나를 받아 고친 이름을 돌려주는 fixForViolation 을 함께 둔다 —
어떤 위반이 자동 수정 가능한지 판단하는 규칙이 두 화면에서 갈리면 안 된다.

동작 변경 없음. 추출 전후 동일함을 테스트로 고정했다."
```

---

### Task 2: 채널 길이 기준을 규칙셋으로 흡수

`channel-name-limits.ts`(하드코딩 채널 상한)와 `keyword-rules.ts`(가이드 §7)가 각각 다른 숫자를 같은 화면에 띄운다. 무신사 리스팅은 "30자 상한"과 "목표 40~70자"를 동시에 본다.

**Files:**

- Modify: `src/lib/sh/keyword-rules.ts`
- Modify: `src/lib/sh/__tests__/keyword-rules.test.ts`
- Delete: `src/components/sh/products/listings/channel-name-limits.ts` (Task 3에서 마지막 소비자를 제거한 뒤)

**Interfaces:**

- Produces:
  - `KeywordRuleSet.channelLimits: { searchName?: number; displayName?: number }` (신규 필드)
  - `type NameField = 'searchName' | 'displayName'`
  - `rulesForNameField(rules: KeywordRuleSet, field: NameField): KeywordRuleSet`
  - `resolveKeywordRules(channel: ChannelIdentity | null, override: KeywordRuleOverride | null): KeywordRuleSet` — **시그니처 변경**(인자 1개 → 2개)
  - `type ChannelIdentity = { name: string; externalSource: string | null }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sh/__tests__/keyword-rules.test.ts`에 추가:

```ts
import { rulesForNameField, resolveKeywordRules, DEFAULT_KEYWORD_RULES } from '../keyword-rules'

describe('resolveKeywordRules — 채널 기본값', () => {
  it('쿠팡은 가이드 §7 값을 쓴다', () => {
    const r = resolveKeywordRules({ name: '쿠팡 로켓그로스', externalSource: null }, null)
    expect(r.nameTargetMin).toBe(40)
    expect(r.nameTargetMax).toBe(70)
    expect(r.nameSoftMax).toBe(80)
    expect(r.nameHardMax).toBe(120)
    expect(r.channelLimits.searchName).toBe(120)
  })

  it('무신사는 검색용 30·노출용 40', () => {
    const r = resolveKeywordRules({ name: '무신사', externalSource: null }, null)
    expect(r.channelLimits.searchName).toBe(30)
    expect(r.channelLimits.displayName).toBe(40)
  })

  it('등록되지 않은 채널은 기본값', () => {
    const r = resolveKeywordRules({ name: '자사몰', externalSource: null }, null)
    expect(r.nameHardMax).toBe(DEFAULT_KEYWORD_RULES.nameHardMax)
    expect(r.channelLimits.searchName).toBeUndefined()
  })

  it('채널이 null 이면 기본값', () => {
    expect(resolveKeywordRules(null, null).nameHardMax).toBe(DEFAULT_KEYWORD_RULES.nameHardMax)
  })

  it('DB 오버라이드가 채널 기본값을 이긴다', () => {
    const r = resolveKeywordRules({ name: '무신사', externalSource: null }, { maxKeywords: 10 })
    expect(r.maxKeywords).toBe(10)
    expect(r.channelLimits.searchName).toBe(30)
  })
})

describe('rulesForNameField', () => {
  it('검색용 상한에서 목표 구간을 파생한다', () => {
    const base = resolveKeywordRules({ name: '무신사', externalSource: null }, null)
    const r = rulesForNameField(base, 'searchName')
    expect(r.nameHardMax).toBe(30)
    expect(r.nameSoftMax).toBe(30)
    expect(r.nameTargetMax).toBe(30)
    expect(r.nameTargetMin).toBe(18) // floor(30 * 0.6)
  })

  it('노출용은 노출용 상한을 쓴다', () => {
    const base = resolveKeywordRules({ name: '무신사', externalSource: null }, null)
    const r = rulesForNameField(base, 'displayName')
    expect(r.nameHardMax).toBe(40)
    expect(r.nameTargetMin).toBe(24) // floor(40 * 0.6)
  })

  it('상한이 없으면 원본 그대로', () => {
    const base = resolveKeywordRules(null, null)
    expect(rulesForNameField(base, 'searchName')).toEqual(base)
  })

  it('목표 하한이 상한을 넘지 않는다', () => {
    const base = resolveKeywordRules({ name: '29CM', externalSource: null }, null)
    const r = rulesForNameField(base, 'searchName')
    expect(r.nameTargetMin).toBeLessThanOrEqual(r.nameTargetMax)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/lib/sh/__tests__/keyword-rules.test.ts`
Expected: FAIL — `rulesForNameField` 없음, `resolveKeywordRules` 인자 개수 불일치

- [ ] **Step 3: 구현**

`src/lib/sh/keyword-rules.ts`에 추가·변경:

```ts
/** 채널별 상품명 글자수 가이드. channel-name-limits.ts 에서 흡수했다. */
export type ChannelNameLimits = {
  searchName?: number
  displayName?: number
}

export type ChannelIdentity = {
  name: string
  externalSource: string | null
}

// 쿠팡은 가이드 §7 이 출처라 120 을 쓴다(구 channel-name-limits 의 100 은 출처 불명이라 버린다).
// 나머지는 각 채널 공지 기준. 채널명 부분일치로 찾는다 — 사용자가 "쿠팡 로켓그로스"처럼 접두어를 붙인다.
const CHANNEL_LIMITS: Array<{ keyword: string; limits: ChannelNameLimits }> = [
  { keyword: '쿠팡', limits: { searchName: 120, displayName: 120 } },
  { keyword: '스마트스토어', limits: { searchName: 50, displayName: 50 } },
  { keyword: '네이버', limits: { searchName: 50, displayName: 50 } },
  { keyword: '29cm', limits: { searchName: 40, displayName: 40 } },
  { keyword: '무신사', limits: { searchName: 30, displayName: 40 } },
  { keyword: '에이블리', limits: { searchName: 40, displayName: 40 } },
  { keyword: '지그재그', limits: { searchName: 40, displayName: 40 } },
  { keyword: '오늘의집', limits: { searchName: 40, displayName: 40 } },
]

function lookupChannelLimits(channel: ChannelIdentity | null): ChannelNameLimits {
  if (!channel) return {}
  const lower = channel.name.toLowerCase()
  for (const entry of CHANNEL_LIMITS) {
    if (lower.includes(entry.keyword)) return entry.limits
  }
  return {}
}

export type NameField = 'searchName' | 'displayName'

/**
 * 필드 상한에서 목표 구간을 다시 파생한 규칙셋.
 *
 * 채널 상한이 30자인데 목표를 40~70 으로 고정하면 사용자에게 상반된 지시가 뜬다.
 * 상한이 없으면 원본을 그대로 돌려준다.
 */
export function rulesForNameField(rules: KeywordRuleSet, field: NameField): KeywordRuleSet {
  const limit = rules.channelLimits[field]
  if (!limit) return rules
  return {
    ...rules,
    nameHardMax: limit,
    nameSoftMax: Math.min(rules.nameSoftMax, limit),
    nameTargetMax: Math.min(rules.nameTargetMax, limit),
    nameTargetMin: Math.min(rules.nameTargetMin, Math.floor(limit * 0.6)),
  }
}
```

`KeywordRuleSet`에 `channelLimits: ChannelNameLimits` 필드를 추가하고, `COUPANG_KEYWORD_RULES`에 `channelLimits: {}`를 넣는다(기본 상수는 채널 무관).

`resolveKeywordRules`를 2인자로 바꾼다:

```ts
export function resolveKeywordRules(
  channel: ChannelIdentity | null,
  row: KeywordRuleOverride | null | undefined
): KeywordRuleSet {
  const channelLimits = lookupChannelLimits(channel)
  const base: KeywordRuleSet = { ...DEFAULT_KEYWORD_RULES, channelLimits }
  // 기존 오버라이드 병합 로직을 base 위에 그대로 적용한다.
  ...
}
```

⚠️ 기존 호출부를 전부 고쳐야 한다: `grep -rn "resolveKeywordRules" src/ app/`

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/lib/sh/__tests__/keyword-rules.test.ts && npm run typecheck`
Expected: PASS, 타입에러 0

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sh/keyword-rules.ts src/lib/sh/__tests__/keyword-rules.test.ts
git commit -m "✨ feat(sh): 채널별 상품명 길이 기준을 규칙셋으로 흡수

채널 상한(channel-name-limits)과 가이드 §7 목표 구간이 서로 다른 숫자를
같은 화면에 띄우고 있었다. 무신사 리스팅은 '30자 상한'과 '목표 40~70자'를
동시에 봤다.

채널 상한을 규칙셋에 싣고, 목표 구간을 그 상한에서 파생한다(rulesForNameField).
무신사 검색용 → 목표 18~30. 모순이 사라진다.

상한은 검색용·노출용이 따로다(무신사 30/40). 쿠팡은 가이드 §7 의 120 을 쓴다 —
구 channel-name-limits 의 100 은 출처가 없어 버린다."
```

---

### Task 3: 노출용 상품명 검증 + 반환 형태 변경

`validateListingNaming`이 `searchName`만 받아 노출용은 검증되지 않는다.

**Files:**

- Modify: `src/lib/sh/keyword-validate.ts:440-470`
- Modify: `src/lib/sh/__tests__/keyword-validate.test.ts:343-360`
- Modify: `src/lib/sh/keyword-warnings.ts:20`
- Modify: `app/api/sh/keywords/validate/route.ts:27`

**Interfaces:**

- Consumes: `rulesForNameField` (Task 2)
- Produces:

  ```ts
  export type ListingNamingResult = {
    searchName: NameValidationResult // 기존 name 에서 개명
    displayName: NameValidationResult | null
    keywords: KeywordValidationResult
    hasError: boolean
  }
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sh/__tests__/keyword-validate.test.ts`의 `validateListingNaming` describe를 교체:

```ts
describe('validateListingNaming', () => {
  const rules = DEFAULT_KEYWORD_RULES

  it('검색용·검색어를 함께 검증한다', () => {
    const r = validateListingNaming({
      searchName: '모노홈 40수 코마사 호텔 타월 200g 5장',
      keywords: ['호텔 타월'],
      rules,
    })
    expect(r.searchName.length).toBeGreaterThan(0)
    expect(r.keywords.violations.some((v) => v.code === 'KW_DUP_WITH_NAME')).toBe(true)
  })

  it('노출용을 주면 함께 검증한다', () => {
    const r = validateListingNaming({
      searchName: '모노홈 호텔 타월',
      displayName: '★특가★ 무료배송 타월',
      keywords: [],
      rules,
    })
    expect(r.displayName).not.toBeNull()
    expect(r.displayName!.violations.some((v) => v.code === 'NAME_SPECIAL_CHARS')).toBe(true)
    expect(r.displayName!.violations.some((v) => v.code === 'NAME_PROMO_TERM')).toBe(true)
  })

  it('노출용이 없으면 null', () => {
    const r = validateListingNaming({ searchName: '타월', keywords: [], rules })
    expect(r.displayName).toBeNull()
  })

  it('노출용은 검색어 중복 판정에 쓰이지 않는다', () => {
    // §10 Rule 1 의 대상은 검색에 쓰이는 이름이다.
    const r = validateListingNaming({
      searchName: '모노홈 타월',
      displayName: '호텔 세면 수건',
      keywords: ['세면 수건'],
      rules,
    })
    expect(r.keywords.violations.some((v) => v.code === 'KW_DUP_WITH_NAME')).toBe(false)
  })

  it('노출용 위반도 hasError 에 반영된다', () => {
    const long = 'x'.repeat(rules.nameHardMax + 1)
    const r = validateListingNaming({ searchName: '타월', displayName: long, keywords: [], rules })
    expect(r.hasError).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/lib/sh/__tests__/keyword-validate.test.ts -t validateListingNaming`
Expected: FAIL — `r.searchName` undefined, `displayName` 없음

- [ ] **Step 3: 구현**

`keyword-validate.ts`:

```ts
export type ListingNamingResult = {
  searchName: NameValidationResult
  /** 노출용을 주지 않았으면 null */
  displayName: NameValidationResult | null
  keywords: KeywordValidationResult
  hasError: boolean
}

export function validateListingNaming(input: {
  searchName: string
  displayName?: string
  keywords: string[]
  categoryNames?: string[]
  optionNames?: string[]
  rules: KeywordRuleSet
}): ListingNamingResult {
  const searchName = validateProductName(
    input.searchName,
    rulesForNameField(input.rules, 'searchName')
  )
  // 노출용은 길이·금지어·특수문자만 본다. 검색어 중복 판정의 기준은 검색용이다(§10 Rule 1).
  const displayName = input.displayName?.trim()
    ? validateProductName(input.displayName, rulesForNameField(input.rules, 'displayName'))
    : null
  const keywords = validateKeywords({
    keywords: input.keywords,
    productName: input.searchName,
    categoryNames: input.categoryNames,
    optionNames: input.optionNames,
    rules: input.rules,
  })
  const hasError =
    searchName.violations.some((v) => v.severity === 'ERROR') ||
    (displayName?.violations.some((v) => v.severity === 'ERROR') ?? false) ||
    keywords.violations.some((v) => v.severity === 'ERROR')
  return { searchName, displayName, keywords, hasError }
}
```

`rulesForNameField`를 import한다.

- [ ] **Step 4: 호출부 2곳 수정**

`src/lib/sh/keyword-warnings.ts` — `result.name` → `result.searchName`. 노출용 경고도 포함하도록 요약 문구를 넓힌다.

`app/api/sh/keywords/validate/route.ts` — body에 `displayName`을 받아 넘긴다(Zod 스키마도 함께). 이 라우트는 현재 소비자가 없어 응답 형태 변경이 안전하다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest && npm run typecheck`
Expected: PASS, 타입에러 0

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sh/keyword-validate.ts src/lib/sh/keyword-warnings.ts app/api/sh/keywords/validate/route.ts src/lib/sh/__tests__/keyword-validate.test.ts
git commit -m "✨ feat(sh): 노출용 상품명 검증 추가

validateListingNaming 이 searchName 만 받아 노출용은 검증이 전혀 없었다.
길이·금지어·특수문자를 함께 본다.

검색어 중복 판정의 기준은 검색용으로 유지한다 — §10 Rule 1 의 대상은
검색에 쓰이는 이름이다. 노출용이 겹친다고 검색어를 빼면 안 된다.

반환 형태를 name → searchName 으로 바꾸고 displayName 을 추가했다.
호출부는 keyword-warnings 와 validate 라우트 둘뿐이다."
```

---

### Task 4: 상품명 검증 패널 컴포넌트

**Files:**

- Create: `src/components/sh/products/listings/name-validation-panel.tsx`
- Create: `src/components/sh/products/listings/name-counter.tsx`

**Interfaces:**

- Consumes: `fixForViolation` (Task 1), `rulesForNameField`·`NameField` (Task 2), `validateProductName`, `NameLengthGauge`(`./steps/name-length-gauge`)
- Produces:

  ```ts
  export function NameValidationPanel(props: {
    value: string
    onChange: (next: string) => void
    field: NameField
    rules: KeywordRuleSet
    readOnly?: boolean
  }): JSX.Element | null

  export function NameCounter(props: { value: string; limit?: number }): JSX.Element
  ```

- [ ] **Step 1: `NameCounter` 통합본 작성**

세 곳(`listing-form.tsx:697`·`listing-create-form.tsx:899`·`group-base-info-card.tsx:249`)에 같은 컴포넌트가 중복 정의돼 있다. 하나로 합친다.

`src/components/sh/products/listings/name-counter.tsx`:

```tsx
'use client'

// 상품명 글자수 표시. 세 폼에 중복 정의돼 있던 것을 합쳤다.

import { cn } from '@/lib/utils'

/** 공백 포함 글자 수. emoji surrogate 쌍은 이 도메인에서 고려하지 않는다. */
export function countChars(value: string): number {
  return value.length
}

export function NameCounter({ value, limit }: { value: string; limit?: number }) {
  const count = countChars(value)
  const over = limit != null && count > limit
  return (
    <span
      className={cn('text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}
    >
      {count}
      {limit != null ? ` / ${limit}` : ''}
    </span>
  )
}
```

- [ ] **Step 2: 검증 패널 작성**

`src/components/sh/products/listings/name-validation-panel.tsx`:

```tsx
'use client'

// 상품명 입력란 하나에 대응하는 위반 표시 + 원클릭 수정.
//
// KeywordEditor 안이 아니라 각 입력란 아래에 둔다 — 키워드 위반과 상품명 위반이
// 한 배지에 섞이면 무엇을 고쳐야 할지 알 수 없다.

import { useMemo } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { fixForViolation } from '@/lib/sh/keyword-fix'
import { rulesForNameField, type KeywordRuleSet, type NameField } from '@/lib/sh/keyword-rules'
import {
  validateProductName,
  type Violation,
  type ViolationSeverity,
} from '@/lib/sh/keyword-validate'
import { cn } from '@/lib/utils'

import { NameLengthGauge } from './steps/name-length-gauge'

const SEVERITY_ICON: Record<ViolationSeverity, typeof AlertCircle> = {
  ERROR: AlertCircle,
  WARN: AlertTriangle,
  INFO: Info,
}

const SEVERITY_CLASS: Record<ViolationSeverity, string> = {
  ERROR: 'text-destructive',
  WARN: 'text-amber-600 dark:text-amber-400',
  INFO: 'text-muted-foreground',
}

type Props = {
  value: string
  onChange: (next: string) => void
  field: NameField
  rules: KeywordRuleSet
  readOnly?: boolean
}

export function NameValidationPanel({ value, onChange, field, rules, readOnly }: Props) {
  const fieldRules = useMemo(() => rulesForNameField(rules, field), [rules, field])
  const result = useMemo(() => validateProductName(value, fieldRules), [value, fieldRules])

  if (!value.trim()) return null

  function fixFor(violation: Violation): (() => void) | null {
    if (readOnly) return null
    const fixed = fixForViolation(value, violation, fieldRules)
    if (fixed === null) return null
    return () => onChange(fixed)
  }

  return (
    <div className="space-y-2">
      <NameLengthGauge length={result.length} rules={fieldRules} />
      {result.violations.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          자동 검사 항목에서 걸린 내용이 없습니다.
        </p>
      ) : (
        <ul className="space-y-1">
          {result.violations.map((v, i) => {
            const Icon = SEVERITY_ICON[v.severity]
            const fix = fixFor(v)
            return (
              <li key={`${v.code}-${i}`} className="flex items-start gap-1.5 text-xs">
                <Icon
                  className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', SEVERITY_CLASS[v.severity])}
                  aria-hidden
                />
                <span className="flex-1">{v.message}</span>
                {fix && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={fix}
                    className="h-6 px-2 text-xs"
                  >
                    {v.conflictWith ? `'${v.conflictWith}' 제거` : '특수문자 제거'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

⚠️ `NameLengthGauge`의 실제 props를 먼저 확인하고 맞춘다: `sed -n '1,40p' src/components/sh/products/listings/steps/name-length-gauge.tsx`

- [ ] **Step 3: 타입체크**

Run: `npm run typecheck`
Expected: 타입에러 0

- [ ] **Step 4: 커밋**

```bash
git add src/components/sh/products/listings/name-validation-panel.tsx src/components/sh/products/listings/name-counter.tsx
git commit -m "✨ feat(sh): 상품명 검증 패널·글자수 카운터 공용 컴포넌트

위반 표시와 원클릭 수정을 입력란 단위로 붙일 수 있게 한다. KeywordEditor
안에 두면 키워드 위반과 상품명 위반이 한 배지에 섞여 무엇을 고쳐야 할지
알 수 없다.

NameCounter 는 세 폼에 같은 코드가 중복 정의돼 있던 것을 합쳤다."
```

---

### Task 5: 폼에 패널 연결

**Files:**

- Modify: `src/components/sh/products/listings/listing-form.tsx`
- Modify: `src/components/sh/products/listings/listing-create-form.tsx`
- Modify: `src/components/sh/products/listings/group-base-info-card.tsx`
- Modify: `src/components/sh/products/listings/keyword-editor.tsx`
- Delete: `src/components/sh/products/listings/channel-name-limits.ts`

**Interfaces:**

- Consumes: `NameValidationPanel`·`NameCounter` (Task 4), `resolveKeywordRules` (Task 2)

- [ ] **Step 1: 규칙 해석을 채널 기준으로**

각 폼에서 현재 선택된 채널로 규칙을 만든다. 채널 정보(`name`·`externalSource`)는 이미 폼 상태에 있다(`listing-form.tsx`의 `Channel` 타입 확인).

```ts
const rules = useMemo(
  () =>
    resolveKeywordRules(
      selectedChannel
        ? { name: selectedChannel.name, externalSource: selectedChannel.externalSource }
        : null,
      null
    ),
  [selectedChannel]
)
```

⚠️ DB 오버라이드(`ChannelKeywordRule`)는 이 단계에서 가져오지 않는다 — 서버에서 채널 규칙을 내려주는 경로가 아직 없다. 두 번째 인자는 `null`로 두고, 규칙 편집 UI(Phase 6)에서 연결한다. 이 사실을 코드 주석으로 남긴다.

- [ ] **Step 2: 입력란 아래에 패널 배치**

`listing-form.tsx`의 검색용(:404-413)·노출용(:418-427) 입력란 각각 아래에:

```tsx
<NameValidationPanel value={searchName} onChange={setSearchName} field="searchName" rules={rules} />
```

`NameCounter`의 `limit`은 `rulesForNameField(rules, field).nameHardMax`를 쓴다 — 카운터와 게이지가 같은 숫자를 보게 한다.

- [ ] **Step 3: 중복 정의 제거**

세 파일의 로컬 `NameCounter` 정의를 지우고 `./name-counter` import로 바꾼다. `channel-name-limits.ts` import를 모두 제거한 뒤 파일을 삭제한다.

Run: `grep -rn "channel-name-limits" src/ app/`
Expected: 출력 없음

- [ ] **Step 4: KeywordEditor에서 상품명 요약 제거**

`keyword-editor.tsx:87-92`의 `validateProductName` 호출과 요약 줄의 상품명 부분(:182-186)을 제거한다. 상품명은 이제 패널이 담당한다. `productName` prop은 **유지한다** — 검색어 중복 판정(§10)에 여전히 필요하다.

- [ ] **Step 5: 생성 폼에 SOP 진입점 추가**

`listing-create-form.tsx`에 `getSellerHubNamingSopPath()` 링크 버튼을 추가한다(리스팅 id가 없으므로 인자 없이 호출 — 연습 모드로 열린다).

- [ ] **Step 6: 전체 검증**

Run: `npx jest && npm run typecheck && npm run lint`
Expected: 테스트 통과, 타입에러 0, lint 에러 0

- [ ] **Step 7: 수동 확인**

`npm run dev`로 띄우고 `/d/seller-ops/products/listings/new?channelId=<쿠팡 채널>`에서:

- 상품명에 `★특가★ 무료배송 타월` 입력 → 특수문자·프로모션 위반 표시 + 제거 버튼 동작
- 20자 입력 → "목표 40~70" 게이지가 미달 구간
- 노출용에도 같은 검증이 뜨는지
- 카운터와 게이지가 같은 상한을 가리키는지

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "✨ feat(sh): 상품명 위반을 입력란 옆에 표시 + 길이 기준 통합

위반은 이미 계산되고 있었는데 keyword-editor 에서 버려지고 있었다. 주석은
'이 화면에서 고칠 수 없으므로'라고 적었지만 상품명 입력란이 바로 그 화면에
있다. 사실과 달랐다.

각 입력란 아래에 NameValidationPanel 을 붙여 위반과 원클릭 수정을 보여준다.
검색용·노출용 각각 자기 채널 상한으로 검증한다.

channel-name-limits 를 지우고 규칙셋 하나만 남긴다. 이제 카운터와 게이지가
같은 숫자를 가리킨다 — 무신사에서 '30자 상한'과 '목표 40~70자'가 동시에
뜨던 문제가 사라진다.

생성 폼에도 SOP 진입점을 넣었다. 신규 등록이야말로 SOP 가 필요한 시점인데
편집 모드에만 링크가 있었다."
```

---

### Task 6: 저장 응답의 경고 노출

서버가 `namingWarnings`를 보내는데 두 폼 다 읽지 않는다.

**Files:**

- Modify: `src/components/sh/products/listings/listing-form.tsx:293-296`
- Modify: `src/components/sh/products/listings/listing-create-form.tsx:600-606`

- [ ] **Step 1: 응답에서 경고를 읽어 toast에 반영**

```ts
const data = await res.json().catch(() => ({}))
const warnCount = Array.isArray(data?.namingWarnings) ? data.namingWarnings.length : 0
toast.success(warnCount > 0 ? `저장했습니다 · 규칙 위반 ${warnCount}건` : '저장했습니다')
```

⚠️ `buildNamingWarnings`의 실제 반환 형태를 먼저 확인해 배열인지 객체인지 맞춘다: `cat src/lib/sh/keyword-warnings.ts`

- [ ] **Step 2: 검증**

Run: `npx jest && npm run typecheck`

- [ ] **Step 3: 커밋**

```bash
git add -A
git commit -m "🐛 fix(sh): 저장 응답의 상품명 경고를 사용자에게 보여준다

서버가 namingWarnings 를 실어 보내는데 두 폼 다 읽지 않아 죽은 코드였다.
클라이언트 검증과 중복이지만 서버가 최종 판정자이므로, 클라이언트 검증을
우회한 경로에서도 사용자가 알 수 있어야 한다."
```

---

## Self-Review

**1. Spec coverage**

| 스펙 항목                     | Task                                |
| ----------------------------- | ----------------------------------- |
| 1-1 상품명 위반을 입력란 옆에 | Task 1(추출) → 4(패널) → 5(연결)    |
| 1-2 노출용 검증               | Task 3                              |
| 1-3 죽은 namingWarnings       | Task 6                              |
| 1-4 생성 폼 SOP 진입점        | Task 5 Step 5                       |
| 2 길이 기준 통합              | Task 2(규칙) → 5(폼 반영·파일 삭제) |

Phase 3·4는 별도 계획으로 분리한다 — 이 계획만으로 배포 가능한 단위다.

**2. Placeholder scan** — 없음. 모든 Step에 실제 코드가 있다. `⚠️` 표시는 실행자가 확인할 사실(실제 props·반환 형태)을 짚은 것이며, 확인 명령을 함께 적었다.

**3. Type consistency**

- `fixForViolation(name, violation, rules)` — Task 1 정의, Task 4 사용. 일치.
- `rulesForNameField(rules, field)` — Task 2 정의, Task 3·4 사용. 일치.
- `NameField` — Task 2 정의, Task 4 props. 일치.
- `ListingNamingResult.searchName` — Task 3에서 `name`에서 개명. Task 3 Step 4가 호출부 2곳을 함께 고친다.
- `NameCounter({ value, limit })` — Task 4 정의, Task 5 사용. 일치.

**남은 위험**: Task 4의 `NameLengthGauge` props와 Task 6의 `namingWarnings` 형태는 실행 시점에 확인해야 한다. 둘 다 해당 Step에 확인 명령을 적었다.
