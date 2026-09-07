# 키워드 마스터 자동 축적 + 상품 축 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리스팅 저장 시 키워드를 마스터로 자동 축적하고(Phase 3), `/d/seller-ops/products/keywords`를 "상품 하나를 골라 모든 판매채널의 상품명·키워드를 한 화면에서 편집"하는 상품 축 2-pane 화면으로 교체한다(Phase 4).

**Architecture:** 축적은 저장 라우트 3곳이 공유하는 서버 전용 헬퍼(`keyword-absorb.ts`)로, 커밋된 트랜잭션 **바깥**에서 best-effort 실행한다. 화면은 좌측 상품 목록 / 우측 채널 카드 목록이고, 카드 하나가 채널상 노출 단위(ChannelProduct 또는 단독 리스팅) 하나에 대응한다. 저장은 기존 PATCH 라우트를 그대로 쓴다.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 7, React 19, shadcn/ui, Tailwind v4, Jest

**Spec:** `docs/decks/seller-hub/prd/keyword-ux-revamp.md` (Phase 3 §174-190, Phase 4 §193-229)

## Global Constraints

- 검증기(`src/lib/sh/keyword-*.ts`)의 **순수 함수 파일은 prisma를 import하지 않는다** — 클라이언트 번들 오염. 신규 `keyword-absorb.ts`는 순수부와 prisma부를 한 파일에 두되 **서버에서만 import**한다(라우트 전용).
- **축적 실패가 저장을 되돌리면 안 된다.** 커밋된 트랜잭션 밖, `try/catch`로 감싸 `console.error` 로깅만. 어떤 경로도 rethrow하지 않는다.
- `Zod .max(30)` 유지. `MAX_TOKENS = 12` 기본값 변경 금지.
- 연동 채널(`Channel.externalSource != null`)은 읽기전용 미러 — 편집 어포던스를 **숨긴다**.
- `InvProductOption`은 소프트 삭제 — 옵션 조회는 전부 `deletedAt: null` 필터.
- 마이그레이션 없음. 이 계획은 스키마를 바꾸지 않는다.
- 응답 언어는 한국어. 커밋은 이모지 + Conventional Commit.

## 사전 판정 (Rulings)

계획 작성 시점에 확정한 것들. 구현자는 이 판정을 따르고, 다시 논의하지 않는다.

- **R1 — 축적 행의 `source`/`status`:** `source: INTERNAL`, `status: SEARCH_TERM`. 채널에 실제 등록된 검색어이므로 미검증 후보(`CANDIDATE`)가 아니다. 틀렸을 때 비용: 사전에 SEARCH_TERM 라벨이 과다해짐 — 일괄 상태 전환으로 되돌릴 수 있다.
- **R2 — `PATCH /channel-products/[id]`의 링크 대상:** `productId`만 건다(`listingId: null`). 채널상품 키워드는 정의상 상품 단위이고, 자식 리스팅으로 팬아웃하면 쓰기량이 리스팅 수만큼 늘어난다. 틀렸을 때 비용: `?listingId=` 필터에서 이 키워드들이 안 보인다 — 상품 축 화면은 `?productId=`를 쓰므로 영향 없다.
- **R3 — 삭제 전파 없음(링크 포함):** 리스팅에서 키워드를 빼도 마스터 행은 물론 **링크도 지우지 않는다.** 축적은 자기가 만든 링크와 사용자가 수동으로 만든 링크를 구별할 수 없어서, 무관한 저장 한 번이 수동 연결을 지우는 쪽이 더 나쁘다. 틀렸을 때 비용: 사전의 "연결 상품" 필터에 과거 키워드가 남는다.
- **R4 — 좌측 목록 API는 신규 라우트:** 스펙은 `GET /api/sh/products/[productId]/listings` 확장을 적었지만, 카드가 필요로 하는 건 ChannelProduct 그룹핑 + base 상품명이라 기존 응답 형태와 다르다. 기존 소비자(`ProductListingsPanel`) 페이로드를 부풀리지 않기 위해 전용 라우트 2개를 신설한다. 틀렸을 때 비용: 라우트 하나가 늘어난다.
- **R5 — 채널 카드 단위:** `channelProductId`가 있으면 ChannelProduct 단위(저장 = `PATCH /listings/channel-products/[id]`), 없으면 단독 리스팅 단위(저장 = `PATCH /listings/[listingId]`). 카드 종류는 서버가 결정해 내려주고 UI는 분기만 한다.
- **R6 — 변경 사유 게이트는 카드마다 건다.** 채널 하나가 각각 독립된 변경 사건이다(§25-26). 저장 버튼 라벨을 `변경 사유 입력 후 저장`으로 미리 바꿔서, 다이얼로그가 튀어나오는 게 놀람이 되지 않게 한다. 게이트 판정 로직 자체는 손대지 않는다.

---

## 파일 구조

| 파일                                                                   | 책임                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| `src/lib/sh/keyword-absorb.ts` (신규)                                  | 순수 `planAbsorb()` + prisma `absorbKeywords()` |
| `src/lib/sh/__tests__/keyword-absorb.test.ts` (신규)                   | `planAbsorb` 단위 테스트                        |
| `app/api/sh/products/listings/route.ts` (수정)                         | POST 후 축적 호출                               |
| `app/api/sh/products/listings/[listingId]/route.ts` (수정)             | PATCH 후 축적 호출                              |
| `app/api/sh/products/listings/channel-products/[id]/route.ts` (수정)   | PATCH 후 축적 호출                              |
| `app/api/sh/products/keyword-overview/route.ts` (신규)                 | 좌측 상품 목록                                  |
| `app/api/sh/products/[productId]/keyword-cards/route.ts` (신규)        | 우측 채널 카드                                  |
| `src/components/sh/products/keywords/product-keyword-card.tsx` (신규)  | 채널 카드 하나 (편집·저장·게이트)               |
| `src/components/sh/products/keywords/product-keyword-panel.tsx` (신규) | 선택 상품의 카드 목록                           |
| `src/components/sh/products/keywords/product-rail.tsx` (신규)          | 좌측 상품 목록                                  |
| `src/components/sh/products/keywords/keyword-workspace.tsx` (신규)     | 2-pane + 탭 셸                                  |
| `app/d/seller-ops/products/keywords/page.tsx` (수정)                   | 셸 교체                                         |
| `docs/decks/seller-hub/prd/keyword-ux-revamp.md` (수정)                | Phase 3·4 완료 표기                             |

---

### Task 1: 축적 헬퍼 `keyword-absorb.ts`

**Files:**

- Create: `src/lib/sh/keyword-absorb.ts`
- Test: `src/lib/sh/__tests__/keyword-absorb.test.ts`

**Interfaces:**

- Consumes: `keywordKeys` from `@/lib/sh/keyword-normalize`, `createOrUpdateLink` from `@/lib/sh/keyword-link`, `prisma` from `@/lib/prisma`
- Produces:
  ```ts
  export type AbsorbPlanItem = {
    keyword: string
    normalized: string
    despaced: string
    sortedKey: string
  }
  export function planAbsorb(raw: unknown): AbsorbPlanItem[]
  export type AbsorbTarget = {
    spaceId: string
    keywords: unknown
    productId: string | null
    listingId: string | null
  }
  export function absorbKeywords(target: AbsorbTarget): Promise<void>
  ```

**배경:** 저장 라우트 3곳이 같은 축적 동작을 공유해야 한다. `createKeywords`(`src/components/sh/products/keywords/create-keywords.ts`)는 `fetch('/api/sh/keywords')`를 쓰는 **클라이언트 헬퍼**라 라우트 안에서 쓰면 안 된다 — 라우트가 자기 HTTP 엔드포인트를 부르면 쿠키·인증 전파에서 깨진다. prisma를 직접 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/sh/__tests__/keyword-absorb.test.ts`:

```ts
import { planAbsorb } from '../keyword-absorb'

describe('planAbsorb', () => {
  it('문자열 배열에서 3키를 만든다', () => {
    expect(planAbsorb(['호텔 타월'])).toEqual([
      {
        keyword: '호텔 타월',
        normalized: '호텔 타월',
        despaced: '호텔타월',
        sortedKey: '타월 호텔',
      },
    ])
  })

  it('normalized 기준으로 중복을 접는다 — 첫 원문을 남긴다', () => {
    const out = planAbsorb(['호텔 타월', '호텔  타월', 'ABC', 'abc'])
    expect(out.map((i) => i.keyword)).toEqual(['호텔 타월', 'ABC'])
  })

  it('빈 문자열·공백·비문자열을 버린다', () => {
    expect(planAbsorb(['', '   ', 1, null, undefined, {}, '수건'])).toEqual([
      { keyword: '수건', normalized: '수건', despaced: '수건', sortedKey: '수건' },
    ])
  })

  it('배열이 아니면 빈 배열', () => {
    expect(planAbsorb(null)).toEqual([])
    expect(planAbsorb('수건')).toEqual([])
    expect(planAbsorb({ 0: '수건' })).toEqual([])
  })
})
```

> `normalized`/`despaced`/`sortedKey`의 정확한 출력은 `keywordKeys`가 결정한다. 위 기대값이 실제와 다르면 **테스트를 실제 출력에 맞춘다** — `keyword-normalize.ts`를 고치지 않는다. 그건 이미 배포돼 검증된 규칙이다.

- [ ] **Step 2: 실패 확인**

```bash
npx jest src/lib/sh/__tests__/keyword-absorb.test.ts
```

Expected: FAIL — Cannot find module '../keyword-absorb'

- [ ] **Step 3: 구현**

`src/lib/sh/keyword-absorb.ts`:

```ts
import { prisma } from '@/lib/prisma'
import { createOrUpdateLink } from '@/lib/sh/keyword-link'
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

    // 링크는 findFirst+create 계약을 지키는 공용 헬퍼를 쓴다.
    // (@@unique 는 NULL 열을 제약하지 않아서 upsert 로는 중복이 쌓인다.)
    for (const item of items) {
      const keywordId = idByNormalized.get(item.normalized)
      if (!keywordId) continue
      await createOrUpdateLink({
        keywordId,
        productId: target.productId,
        listingId: target.listingId,
      })
    }
  } catch (e) {
    // R3 계약: 흡수 실패는 저장을 되돌리지 않는다. 로깅만 하고 삼킨다.
    console.error('[keyword-absorb] 흡수 실패', e)
  }
}
```

> `createOrUpdateLink`의 `LinkTarget` 타입이 `productId?: string | null` 형태가 아니면 `src/lib/sh/keyword-link.ts`의 시그니처에 맞춰 호출부를 조정한다. **`keyword-link.ts` 자체는 고치지 않는다** — 이미 배포된 API 라우트가 쓰고 있다.

- [ ] **Step 4: 통과 확인**

```bash
npx jest src/lib/sh/__tests__/keyword-absorb.test.ts
npx tsc --noEmit
```

Expected: PASS, 타입 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sh/keyword-absorb.ts src/lib/sh/__tests__/keyword-absorb.test.ts
git commit -m "✨ feat(sh): 키워드 마스터 흡수 헬퍼 추가"
```

---

### Task 2: 저장 라우트 3곳에 축적 연결

**Files:**

- Modify: `app/api/sh/products/listings/route.ts` (POST)
- Modify: `app/api/sh/products/listings/[listingId]/route.ts` (PATCH, :270-282 부근)
- Modify: `app/api/sh/products/listings/channel-products/[id]/route.ts` (PATCH, :324 트랜잭션 이후)

**Interfaces:**

- Consumes: `absorbKeywords` from Task 1

세 라우트 모두 이미 "구성 상품이 정확히 하나일 때만 귀속"하는 `logProductId`를 계산해 둔다. 그 값을 그대로 재사용한다 — 같은 판정을 두 번 구현하지 않는다.

- [ ] **Step 1: `PATCH /listings/[listingId]` 연결**

`await prisma.$transaction(...)` 블록이 끝난 **직후**, `buildNamingWarnings` 호출 앞에 넣는다:

```ts
// 저장이 커밋된 뒤에 흡수한다 — 트랜잭션 안에 넣으면 흡수 실패가 저장을 되돌린다.
await absorbKeywords({
  spaceId: resolved.space.id,
  keywords: nextKeywords,
  productId: logProductId,
  listingId,
})
```

import 추가: `import { absorbKeywords } from '@/lib/sh/keyword-absorb'`

- [ ] **Step 2: `PATCH /channel-products/[id]` 연결**

`const updated = await prisma.$transaction(...)` 이 끝난 직후:

```ts
// R2: 채널상품 키워드는 정의상 상품 단위다. 자식 리스팅으로 팬아웃하지 않는다.
await absorbKeywords({
  spaceId: resolved.space.id,
  keywords: nextKeywords,
  productId: logProductId,
  listingId: null,
})
```

- [ ] **Step 3: `POST /listings` 연결**

이 라우트에서 리스팅을 생성한 뒤, 응답을 만들기 전에 넣는다. 생성된 리스팅 id 와 구성 상품 id 판정이 이 라우트에 이미 있으면 그것을 쓰고, 없으면 생성에 쓴 `items`의 옵션 → `productId` 집합이 크기 1일 때만 `productId`를 넘긴다:

```ts
const createdProductIds = new Set(validOptions.map((o) => o.productId))
await absorbKeywords({
  spaceId: resolved.space.id,
  keywords: input.keywords ?? [],
  productId: createdProductIds.size === 1 ? [...createdProductIds][0] : null,
  listingId: created.id,
})
```

> 라우트의 실제 변수명(`validOptions`, `created`)이 다르면 그 파일의 이름을 따른다. **없는 변수를 새로 만들지 말고**, 이미 검증된 옵션 목록을 재사용한다.

- [ ] **Step 4: 검증**

```bash
npx tsc --noEmit
npm run lint
npx jest src/lib/sh
```

Expected: 전부 통과

축적이 저장을 막지 않는지 코드로 확인한다: `absorbKeywords` 호출이 `try` 없이 그대로 `await` 돼 있어도 괜찮다 — 헬퍼 내부가 삼킨다. **호출부에 `throw`를 새로 만들지 않았는지** 눈으로 확인할 것.

- [ ] **Step 5: 커밋**

```bash
git add app/api/sh/products/listings
git commit -m "✨ feat(sh): 리스팅 저장 시 키워드 마스터 자동 축적"
```

---

### Task 3: 상품 축 조회 API 2종

**Files:**

- Create: `app/api/sh/products/keyword-overview/route.ts`
- Create: `app/api/sh/products/[productId]/keyword-cards/route.ts`

**Interfaces:**

- Produces (좌측 목록):
  ```ts
  GET /api/sh/products/keyword-overview?q=&page=&pageSize=
  → { data: Array<{ id: string; name: string; brandName: string | null; channelCount: number; listingCount: number }>, total: number, page: number, pageSize: number }
  ```
- Produces (우측 카드):

  ```ts
  GET /api/sh/products/[productId]/keyword-cards
  → { cards: Array<{
        kind: 'channelProduct' | 'listing'
        id: string                    // 저장 대상 id (kind 에 따라 channelProductId 또는 listingId)
        channelId: string
        channelName: string
        externalSource: string | null // non-null 이면 읽기전용 미러
        searchName: string
        displayName: string | null
        keywords: string[]
        listingCount: number          // channelProduct 카드일 때 묶인 판매 옵션 수
      }> }
  ```

- [ ] **Step 1: 좌측 목록 라우트**

```ts
import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * 상품 축 키워드 화면의 좌측 목록.
 * 판매채널 상품이 하나라도 있는 상품만 보여준다 — 채널에 안 나가는 상품은
 * 이 화면에서 할 일이 없다.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const q = (searchParams.get('q') ?? '').trim()
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 30)))

  const where: Prisma.InvProductWhereInput = {
    spaceId: resolved.space.id,
    status: 'ACTIVE',
    options: { some: { deletedAt: null, listingItems: { some: {} } } },
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { internalName: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.invProduct.findMany({
      where,
      orderBy: [{ internalName: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        internalName: true,
        brand: { select: { name: true } },
        options: {
          where: { deletedAt: null },
          select: { listingItems: { select: { listing: { select: { channelId: true } } } } },
        },
      },
    }),
    prisma.invProduct.count({ where }),
  ])

  const data = rows.map((p) => {
    const channelIds = new Set<string>()
    let listingCount = 0
    for (const o of p.options) {
      for (const li of o.listingItems) {
        channelIds.add(li.listing.channelId)
        listingCount += 1
      }
    }
    return {
      id: p.id,
      name: p.internalName ?? p.name,
      brandName: p.brand?.name ?? null,
      channelCount: channelIds.size,
      listingCount,
    }
  })

  return NextResponse.json({ data, total, page, pageSize })
}
```

> `InvProductOption` ↔ `ProductListingItem` 의 실제 relation 이름(`listingItems`)이 스키마와 다르면 `prisma/schema.prisma`의 이름을 따른다. `internalName` 필드가 없으면 `name`만 쓴다. **추측하지 말고 스키마를 열어 확인할 것.**

- [ ] **Step 2: 우측 카드 라우트**

```ts
import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ productId: string }> }

type Card = {
  kind: 'channelProduct' | 'listing'
  id: string
  channelId: string
  channelName: string
  externalSource: string | null
  searchName: string
  displayName: string | null
  keywords: string[]
  listingCount: number
}

function toKeywordList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
}

/**
 * 상품 하나가 나가는 모든 판매채널의 편집 카드.
 *
 * R5: 카드 단위는 "채널상 노출 단위"다 — ChannelProduct 에 묶인 리스팅들은 base 상품명을
 * 공유하므로 카드 하나로 접고, 묶이지 않은 단독 리스팅은 자기 카드를 갖는다.
 * 여러 상품이 섞인 세트 리스팅은 제외한다 — 이 상품의 이름이라 말할 수 없다.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const listings = await prisma.productListing.findMany({
    where: { spaceId: resolved.space.id, items: { some: { option: { productId } } } },
    select: {
      id: true,
      channelId: true,
      channelProductId: true,
      searchName: true,
      displayName: true,
      keywords: true,
      channel: { select: { name: true, externalSource: true } },
      channelProduct: {
        select: {
          id: true,
          baseSearchName: true,
          baseDisplayName: true,
          keywords: true,
        },
      },
      items: { select: { option: { select: { productId: true } } } },
    },
    orderBy: [{ channelId: 'asc' }, { updatedAt: 'desc' }],
  })

  const cards = new Map<string, Card>()
  for (const l of listings) {
    // 혼합 세트는 이 상품의 상품명이라 말할 수 없다 — 제외.
    if (new Set(l.items.map((it) => it.option.productId)).size !== 1) continue

    if (l.channelProduct) {
      const key = `cp:${l.channelProduct.id}`
      const hit = cards.get(key)
      if (hit) {
        hit.listingCount += 1
        continue
      }
      cards.set(key, {
        kind: 'channelProduct',
        id: l.channelProduct.id,
        channelId: l.channelId,
        channelName: l.channel.name,
        externalSource: l.channel.externalSource,
        searchName: l.channelProduct.baseSearchName,
        displayName: l.channelProduct.baseDisplayName,
        keywords: toKeywordList(l.channelProduct.keywords),
        listingCount: 1,
      })
      continue
    }

    cards.set(`ls:${l.id}`, {
      kind: 'listing',
      id: l.id,
      channelId: l.channelId,
      channelName: l.channel.name,
      externalSource: l.channel.externalSource,
      searchName: l.searchName,
      displayName: l.displayName,
      keywords: toKeywordList(l.keywords),
      listingCount: 1,
    })
  }

  return NextResponse.json({ cards: [...cards.values()] })
}
```

- [ ] **Step 3: 검증**

```bash
npx tsc --noEmit
npm run lint
```

Expected: 통과. relation 이름이 틀렸으면 여기서 잡힌다.

- [ ] **Step 4: 커밋**

```bash
git add app/api/sh/products/keyword-overview app/api/sh/products/\[productId\]/keyword-cards
git commit -m "✨ feat(sh): 상품 축 키워드 조회 API 추가"
```

---

### Task 4: 채널 카드 컴포넌트

**Files:**

- Create: `src/components/sh/products/keywords/product-keyword-card.tsx`

**Interfaces:**

- Consumes: Task 3 의 `Card` 타입, `NameValidationPanel`·`NameCounter` (`@/components/sh/products/listings/`), `KeywordEditor`, `KeywordChangeDialog`, `resolveKeywordRules`·`withChannelDefaults`·`rulesForNameField` (`@/lib/sh/keyword-rules`)
- Produces: `export function ProductKeywordCard({ card, onSaved }: { card: KeywordCard; onSaved: () => void })`

카드 하나가 채널 하나의 상품명 2종 + 키워드를 편집하고 저장까지 한다. **리스팅 폼으로 튕겨 보내지 않는다** — 그러면 "한번에 관리하는 공간"이 아니다.

- [ ] **Step 1: 컴포넌트 작성**

핵심 요구사항(코드 구조는 기존 `group-base-info-card.tsx`·`listing-form.tsx` 관례를 따른다):

1. 로컬 상태 `searchName` / `displayName` / `keywords`, 초기값은 `card`.
2. 규칙:
   ```tsx
   const rules = useMemo(
     () =>
       withChannelDefaults(resolveKeywordRules(null), {
         name: card.channelName,
         externalSource: card.externalSource,
       }),
     [card.channelName, card.externalSource]
   )
   ```
3. 검색용·노출용 입력 각각 아래에 `<NameValidationPanel value={...} onChange={...} field="searchName" rules={rules} readOnly={readOnly} />` (노출용은 `field="displayName"`), 라벨 우측에 `<NameCounter value={...} limit={...} guide />`.
4. 키워드는 `<KeywordEditor value={keywords} onChange={setKeywords} productName={searchName} rules={rules} />`.
5. **읽기전용 미러**: `const readOnly = card.externalSource != null`. true 면 모든 입력에 `readOnly`, 저장 버튼을 **렌더하지 않고**, 헤더에 자물쇠 아이콘 + `연동 채널 (읽기전용)` 배지.
6. 저장:
   - dirty 판정: `searchName`/`displayName`/`keywords` 중 하나라도 초기값과 다르면 true.
   - 게이트 판정: 상품명 또는 키워드가 바뀌었으면 사유 필요(R6). 저장 버튼 라벨을 그때 `변경 사유 입력 후 저장`으로 바꾼다.
   - 클릭 → 게이트 필요하면 `KeywordChangeDialog` 열고, 확인 콜백의 `KeywordChangeMeta`를 body 에 실어 PATCH. 필요 없으면 바로 PATCH.
   - 엔드포인트:
     ```ts
     const url =
       card.kind === 'channelProduct'
         ? `/api/sh/products/listings/channel-products/${card.id}`
         : `/api/sh/products/listings/${card.id}`
     const body =
       card.kind === 'channelProduct'
         ? { baseSearchName: searchName, baseDisplayName: displayName, keywords, ...meta }
         : { searchName, displayName, keywords, ...meta }
     ```
   - 성공 시 `toast.success('저장했습니다')` + `onSaved()`. 실패 시 응답의 `message`를 토스트로.
7. **자동저장 없음.** 명시적 저장 버튼만 둔다 — 게이트가 걸리는 필드라 자동저장과 섞으면 앞선 릴리스에서 나온 혼란이 재발한다.

- [ ] **Step 2: 검증**

```bash
npx tsc --noEmit
npm run lint
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/sh/products/keywords/product-keyword-card.tsx
git commit -m "✨ feat(sh): 상품 축 채널 카드 컴포넌트"
```

---

### Task 5: 2-pane 셸 + 사전 탭 강등

**Files:**

- Create: `src/components/sh/products/keywords/product-rail.tsx`
- Create: `src/components/sh/products/keywords/product-keyword-panel.tsx`
- Create: `src/components/sh/products/keywords/keyword-workspace.tsx`
- Modify: `app/d/seller-ops/products/keywords/page.tsx`

**Interfaces:**

- Consumes: Task 3 의 두 라우트, Task 4 의 `ProductKeywordCard`, 기존 `KeywordMasterView`
- Produces: `export function KeywordWorkspace()`

- [ ] **Step 1: `product-rail.tsx`**

`GET /api/sh/products/keyword-overview` 를 호출해 상품 목록을 그린다. `channel-rail.tsx` 의 구조를 따른다 — 검색 인풋 + 목록 + 선택 하이라이트 + "더 보기" 페이지네이션. 각 행: 상품명(굵게) / 브랜드 · `채널 N개` (작게).

```tsx
export function ProductRail({
  selectedProductId,
  onSelectProduct,
}: {
  selectedProductId: string | null
  onSelectProduct: (id: string) => void
})
```

첫 로드에서 목록이 비어 있지 않으면 **첫 상품을 자동 선택**한다(빈 우측 패널로 시작하지 않는다).

- [ ] **Step 2: `product-keyword-panel.tsx`**

```tsx
export function ProductKeywordPanel({ productId }: { productId: string | null })
```

- `productId` 가 null 이면 `상품을 선택하세요` 안내.
- `GET /api/sh/products/[productId]/keyword-cards` 로 카드를 받아 `ProductKeywordCard` 를 세로로 나열. `onSaved` 는 재조회.
- 카드가 0개면 `이 상품이 등록된 판매채널이 없습니다`.
- 로딩 중에는 스켈레톤 또는 `불러오는 중…`.

- [ ] **Step 3: `keyword-workspace.tsx`**

```tsx
'use client'

import { useState } from 'react'

import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { KeywordMasterView } from './keyword-master-view'
import { ProductKeywordPanel } from './product-keyword-panel'
import { ProductRail } from './product-rail'

/**
 * 상품 축이 기본 화면이고, 키워드 사전(마스터)은 탭으로 강등한다.
 * 중복 탐지·금지어 관리는 여전히 필요하지만 일상 작업의 진입점은 아니다.
 */
export function KeywordWorkspace() {
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

  return (
    <Tabs defaultValue="products">
      <TabsList>
        <TabsTrigger value="products">상품별 관리</TabsTrigger>
        <TabsTrigger value="dictionary">키워드 사전</TabsTrigger>
      </TabsList>
      <TabsContent value="products" className="mt-4">
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Card className="p-3">
            <ProductRail
              selectedProductId={selectedProductId}
              onSelectProduct={setSelectedProductId}
            />
          </Card>
          <ProductKeywordPanel productId={selectedProductId} />
        </div>
      </TabsContent>
      <TabsContent value="dictionary" className="mt-4">
        <KeywordMasterView />
      </TabsContent>
    </Tabs>
  )
}
```

- [ ] **Step 4: 페이지 교체**

`app/d/seller-ops/products/keywords/page.tsx` 의 `KeywordMasterView` 를 `KeywordWorkspace` 로 바꾸고, 설명 문구를 상품 축에 맞게 고친다:

```tsx
<p className="text-sm text-muted-foreground">
  상품을 고르면 그 상품이 나가는 모든 판매채널의 상품명·검색어를 한 화면에서 관리합니다
</p>
```

- [ ] **Step 5: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/components/sh/products/keywords app/d/seller-ops/products/keywords
git commit -m "✨ feat(sh): 키워드 관리를 상품 축 2-pane 으로 교체"
```

---

### Task 6: 문서 갱신 + 전체 검증

**Files:**

- Modify: `docs/decks/seller-hub/prd/keyword-ux-revamp.md`

- [ ] **Step 1: 스펙에 완료 표기**

Phase 3·4 제목 옆에 `(✅ 구현 완료 — 2026-08-21)` 를 붙이고, 계획과 달라진 판정(R2·R3·R4·R5)을 각 Phase 아래 짧게 적는다. 특히:

- Phase 3: 링크 삭제 전파 없음(R3), 채널상품은 productId 링크만(R2)
- Phase 4: 스펙의 "`[productId]/listings` 확장" 대신 전용 라우트 2개(R4), 카드 단위는 ChannelProduct 우선(R5)

- [ ] **Step 2: 전체 검증**

```bash
npm test
npm run lint
npm run build
```

Expected: 전부 통과. 테스트 수가 Task 1 이전보다 늘어야 한다.

- [ ] **Step 3: 커밋**

```bash
git add docs/decks/seller-hub/prd/keyword-ux-revamp.md
git commit -m "📝 docs(sh): 키워드 개편 Phase 3·4 완료 반영"
```

---

## 함정 체크리스트

1. **`createKeywords` 는 클라이언트 헬퍼** — 라우트에서 쓰면 안 된다. prisma 직접.
2. **흡수는 트랜잭션 밖 + 절대 throw 금지.** 호출부에 새 throw 를 만들지 않는다.
3. **`createOrUpdateLink` 는 findFirst+create** — upsert 로 바꾸면 NULL 열 때문에 링크가 중복 누적된다.
4. **`InvProductOption.deletedAt` 소프트 삭제** — 옵션 조회 전부 `deletedAt: null`.
5. **연동 채널 카드는 편집 어포던스를 숨긴다** (`externalSource != null`).
6. **혼합 세트 리스팅 제외** — 여러 상품이 섞인 리스팅은 특정 상품의 카드가 될 수 없다.
7. **Prisma relation 이름을 추측하지 않는다** — `prisma/schema.prisma` 를 열어 확인.
8. **자동저장 금지** — 게이트 필드와 섞이면 사용자가 저장 실패로 오인한다.
9. **마이그레이션 없음** — 이 계획에서 `prisma migrate` 를 실행할 일은 없다.

## 검증

- `npm test` / `npm run lint` / `npm run build` 전부 통과
- 리스팅 저장 → `KeywordMaster` 행 + `KeywordMasterLink` 생성 확인
- 같은 키워드로 재저장 → 마스터 행·링크 중복 생성 없음
- 리스팅에서 키워드 삭제 후 저장 → 마스터 행·링크 **유지**(R3)
- 상품 선택 → 채널별 카드 표시, 인라인 저장 → `KeywordChangeLog` 기록
- 연동 채널 카드가 읽기전용인지 확인
- **릴리스**: 작업 브랜치 → develop → 검증 → release PR → main
