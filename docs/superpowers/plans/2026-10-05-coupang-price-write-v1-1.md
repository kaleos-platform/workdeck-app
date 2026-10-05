# 쿠팡 판매가 쓰기 v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가격시뮬 판매가를 승인 없이 바로 쿠팡(판매가 + 자동조정 최저가)에 반영하고, 세트 반영·일괄 매칭·워크덱 판매가 동기화를 더한다.

**Architecture:** 이미 구현된 v1(쿠팡 PUT 클라이언트·워커 쓰기 잡·상품 API 수집)은 그대로 두고, 앱 쪽 진입 경로만 바꾼다 — 승인 큐 액션 대신 `POST /api/sh/coupang-price/apply` 가 `CoupangWriteJob` 을 직접 만들고, 다이얼로그가 잡을 폴링해 결과를 보여준다. 대상 계산은 미리보기·반영이 같은 서버 함수(`computePriceTargets`)를 쓰고, 리스팅 매칭은 "가격시뮬 행(rows) ↔ 리스팅 구성" 일대일 대응으로 일반화한다. 매칭 후보는 기존 로켓그로스 재고 매핑을 거슬러 조회 시점에 계산한다(저장 안 함).

**Tech Stack:** Next.js 16 App Router, Prisma 7(PostgreSQL), zod, Jest(앱), `node:test` + tsx(워커), shadcn/ui.

**Spec:** `docs/decks/coupang-ads/prd/PRD_PRICE_WRITE_V1_1.md` (차분) + `docs/decks/coupang-ads/prd/PRD_PRICE_WRITE_V1.md` (기반)

## Global Constraints

- 작업 위치: 워크트리 `/Users/kaleos/projects/workdeck-app-coupang-price`, 브랜치 `feat/coupang-price-write`. 다른 워크트리에서 git 조작 금지.
- **쿠팡 API 호출은 워커에서만**(IP allowlist). 앱 라우트에 쿠팡 fetch 금지.
- 쿠팡 판매가 = 시뮬 할인·프로모션 **적용 전** 판매가, `roundPriceTo10`. 최저가 = `ceilMinPriceTo10(recommendedRetail.min)`. `includeVat=false` 는 차단.
- 반영은 항상 `apActive: true`.
- 기존 마이그레이션 `20260922130000_coupang_price_write` 수정 금지(dev DB 적용됨). 이 계획은 스키마 변경 없음.
- 응답은 래퍼 객체로 감싼다(`{ job }`, `{ rows }` …) — 레포 관례. 클라이언트는 라우트의 `NextResponse.json` 형태를 그대로 읽는다.
- 커밋 메시지: `✨ feat(coupang-ads): …` / `🐛 fix(coupang-ads): …` / `🔥 remove(coupang-ads): …` + 마지막 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 루트 `npx tsc --noEmit` 은 **워커를 검사하지 않는다**(tsconfig exclude). 기존 에러 `next.config.ts` `agentRules` 1건은 베이스라인. 워커는 `cd worker && npx tsc --noEmit`(베이스라인: `analysis-poller.ts` 4건).
- 앱 테스트: `npx jest <path>`. `*.e2e.test.ts` 는 `DATABASE_URL` 없으면 조용히 skip — 이 계획의 새 테스트는 전부 prisma mock 단위 테스트로 쓴다.
- Vercel 빌드는 **테스트 파일도 타입체크**한다. 필터 없이 전체 `tsc` 를 돌려 베이스라인과 비교할 것.

## Review Focus

1. **세트 구성의 행 순서·중복** — 시뮬 행 순서와 리스팅 item 순서가 달라도 같은 세트로 매칭되고, 같은 옵션그룹이 두 행에 있는 세트(A그룹×1 + A그룹×1)도 매칭돼야 한다. → Task 1 테스트.
2. **반영 연타·중복 잡** — 다이얼로그에서 반영을 두 번 누르거나 진행 중에 다른 채널 카드에서 반영하면 409 로 막혀야 한다. → Task 3 테스트.
3. **RG 축 반영이 워크덱 판매가를 덮어쓰지 않을 것** — 로켓그로스 카드에서 반영해도 `ProductListing.retailPrice` 는 그대로. → Task 4 테스트.
4. **이미 확정된 매칭을 자동 후보가 덮지 않을 것** — 확정 항목은 후보가 달라도 `NEEDS_REVIEW` 표시만, 일괄 확정 대상에서 제외. → Task 7 테스트.
5. **MEMBER 역할의 반영 시도** — 승인이 없어졌으니 API 가 직접 막아야 한다(403). → Task 3 테스트.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/lib/sh/coupang-price/listing-derive.ts` | 시뮬 rows ↔ 리스팅 구성 매칭(순수) | 수정 |
| `src/lib/sh/coupang-price/compute-targets.ts` | 미리보기·반영 공용 서버 대상 계산 | 신규 |
| `app/api/sh/coupang-price/preview/route.ts` | 미리보기 | 수정(위 함수 호출) |
| `app/api/sh/coupang-price/apply/route.ts` | 반영 잡 생성 | 신규 |
| `app/api/sh/coupang-price/jobs/route.ts` | 채널별 최근 반영 잡 조회 | 신규 |
| `app/api/coupang/write-jobs/[jobId]/report/route.ts` | 워커 결과 기록 + 판매가 동기화 | 수정 |
| `src/lib/agent/actions/coupang-price.ts` 외 | 승인 액션·Slack 결과 알림 | 삭제 |
| `src/components/sh/products/pricing-sim/coupang-price-apply-dialog.tsx` | 반영 다이얼로그 | 수정 |
| `src/components/sh/products/pricing-sim/pricing-quick-flow.tsx` | rows 전달·버튼 활성 조건 | 수정 |
| `src/components/sh/products/pricing-sim/pricing-channel-board-card.tsx` | 비활성 사유 툴팁 | 수정 |
| `src/lib/sh/coupang-price/match-candidates.ts` | 자동 매칭 후보(순수) | 신규 |
| `src/lib/sh/coupang-price/load-matching.ts` | 후보 계산용 DB 로더 | 신규 |
| `src/lib/sh/coupang-price/link-item.ts` | 연결 검증·저장(링크 라우트·일괄 확정 공용) | 신규 |
| `app/api/sh/coupang-price/matching/route.ts` | 매칭 목록 | 신규 |
| `app/api/sh/coupang-price/matching/confirm/route.ts` | 일괄 확정 | 신규 |
| `app/api/sh/coupang-price/link/route.ts` | 연결(POST)·해제(DELETE) | 수정 |
| `app/api/sh/coupang-price/sync/route.ts` | 상품 수동 불러오기 | 신규 |
| `src/components/sh/products/listings/coupang-matching-view.tsx` | 매칭 화면 | 신규 |
| `app/d/seller-ops/products/listings/coupang-matching/page.tsx` | 매칭 페이지 | 신규 |
| `src/lib/deck-routes.ts` | 경로 상수 | 수정 |
| `app/d/seller-ops/products/listings/page.tsx` | 매칭 화면 진입 버튼 | 수정 |

---

### Task 1: rows ↔ 리스팅 구성 매칭 일반화 (세트 지원)

**Files:**
- Modify: `src/lib/sh/coupang-price/listing-derive.ts`
- Test: `src/lib/sh/coupang-price/__tests__/listing-derive.test.ts`

**Interfaces:**
- Produces:
  - `export type PriceRow = { optionIds: string[]; quantity: number }`
  - `export type ListingSignature = { optionId: string; quantity: number }` (유지)
  - `export function signatureOf(items: ListingSignature[]): string` (유지)
  - `export function matchesRows(items: ListingSignature[], rows: PriceRow[]): boolean`
  - `export function deriveListings(rows: PriceRow[], listings: Array<{ id: string; items: ListingSignature[] }>): { matched: string[]; ambiguous: string[][]; unmatched: string[] }` — **첫 인자가 단일 group 에서 rows 배열로 바뀐다.**

- [ ] **Step 1: 기존 테스트를 rows 시그니처로 옮기고 세트 테스트 추가**

파일 전체를 아래로 교체:

```ts
import { deriveListings, matchesRows } from '../listing-derive'

const single = [{ optionIds: ['op-green', 'op-beige', 'op-charcoal'], quantity: 1 }]

test('단일 행 — 구성 시그니처가 일치하는 리스팅을 색상 수만큼 찾는다', () => {
  const listings = [
    { id: 'L-green', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-beige', items: [{ optionId: 'op-beige', quantity: 1 }] },
    { id: 'L-charcoal', items: [{ optionId: 'op-charcoal', quantity: 1 }] },
    { id: 'L-green-2', items: [{ optionId: 'op-green', quantity: 2 }] },
    { id: 'L-other', items: [{ optionId: 'op-xxx', quantity: 1 }] },
  ]
  const r = deriveListings(single, listings)
  expect(r.matched).toEqual(['L-beige', 'L-charcoal', 'L-green'])
  expect(r.ambiguous).toEqual([])
  expect(r.unmatched).toEqual([])
})

test('같은 구성 리스팅이 2개면 모호로 분류하고 matched 에 넣지 않는다', () => {
  const listings = [
    { id: 'L-a', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-b', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-beige', items: [{ optionId: 'op-beige', quantity: 1 }] },
  ]
  const r = deriveListings(single, listings)
  expect(r.matched).toEqual(['L-beige'])
  expect(r.ambiguous).toEqual([['L-a', 'L-b']])
  expect(r.unmatched).toEqual(['op-charcoal'])
})

test('단일 행은 2종 구성 세트 리스팅과 매칭되지 않는다', () => {
  const r = deriveListings(
    [{ optionIds: ['op-a'], quantity: 1 }],
    [{ id: 'L-mix', items: [{ optionId: 'op-b', quantity: 1 }, { optionId: 'op-a', quantity: 1 }] }]
  )
  expect(r.matched).toEqual([])
})

test('2행 세트 — 각 행에서 하나씩 고른 조합 리스팅을 모두 찾고, 단품은 제외한다', () => {
  const rows = [
    { optionIds: ['A1', 'A2'], quantity: 1 },
    { optionIds: ['B1'], quantity: 2 },
  ]
  const listings = [
    { id: 'S-A1B1', items: [{ optionId: 'B1', quantity: 2 }, { optionId: 'A1', quantity: 1 }] },
    { id: 'S-A2B1', items: [{ optionId: 'A2', quantity: 1 }, { optionId: 'B1', quantity: 2 }] },
    { id: 'single-A1', items: [{ optionId: 'A1', quantity: 1 }] }, // 세트가가 단품에 쓰이면 안 된다
    { id: 'S-A1B1-q1', items: [{ optionId: 'A1', quantity: 1 }, { optionId: 'B1', quantity: 1 }] },
  ]
  const r = deriveListings(rows, listings)
  expect(r.matched).toEqual(['S-A1B1', 'S-A2B1'])
  expect(r.unmatched).toEqual([])
})

test('같은 옵션그룹 두 행(A×1 + A×1) 세트도 매칭된다', () => {
  const rows = [
    { optionIds: ['A1', 'A2'], quantity: 1 },
    { optionIds: ['A1', 'A2'], quantity: 1 },
  ]
  expect(
    matchesRows([{ optionId: 'A2', quantity: 1 }, { optionId: 'A1', quantity: 1 }], rows)
  ).toBe(true)
  expect(matchesRows([{ optionId: 'A1', quantity: 1 }], rows)).toBe(false)
})

test('리스팅이 없는 옵션은 unmatched 로 돌려준다', () => {
  const r = deriveListings(single, [{ id: 'L-green', items: [{ optionId: 'op-green', quantity: 1 }] }])
  expect(r.unmatched).toEqual(['op-beige', 'op-charcoal'])
})

test('rows 가 비면 아무것도 매칭하지 않는다', () => {
  expect(deriveListings([], [{ id: 'L', items: [] }])).toEqual({ matched: [], ambiguous: [], unmatched: [] })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/lib/sh/coupang-price/__tests__/listing-derive.test.ts`
Expected: FAIL — `matchesRows` 미존재, `deriveListings` 인자 형태 불일치.

- [ ] **Step 3: 구현**

`listing-derive.ts` 전체 교체:

```ts
/**
 * 가격시뮬 행(rows) → 쿠팡 채널 리스팅 유도.
 *
 * 시뮬 행 = { optionIds(같은 가격의 옵션 묶음), quantity }. 행이 여러 개면 세트다.
 * 리스팅 L 이 대상이려면 L.items 와 rows 사이에 일대일 대응이 있어야 한다 —
 * 각 item 의 optionId 가 대응 행의 optionIds 에 있고 quantity 가 같다.
 * 행 1개면 옵션별 단품 리스팅, 행 N개면 각 행에서 하나씩 고른 조합 세트 리스팅이 된다.
 * item 수가 다르면 절대 매칭되지 않으므로 세트가가 단품에 쓰이는 경로가 구조적으로 닫힌다.
 *
 * 이름 매칭은 쓰지 않는다 — ChannelProductAlias 가 같은 발상으로 매칭률 0 이었다.
 */
export type ListingSignature = { optionId: string; quantity: number }
export type PriceRow = { optionIds: string[]; quantity: number }

export function signatureOf(items: ListingSignature[]): string {
  return items
    .map((i) => `${i.optionId}x${i.quantity}`)
    .sort()
    .join(',')
}

/** items ↔ rows 일대일 대응 존재 여부. 행 수가 작아(실측 수 개) 백트래킹으로 충분하다. */
export function matchesRows(items: ListingSignature[], rows: PriceRow[]): boolean {
  if (items.length === 0 || items.length !== rows.length) return false
  const used = new Array<boolean>(rows.length).fill(false)
  const assign = (i: number): boolean => {
    if (i === items.length) return true
    for (let r = 0; r < rows.length; r++) {
      if (used[r]) continue
      if (rows[r].quantity !== items[i].quantity) continue
      if (!rows[r].optionIds.includes(items[i].optionId)) continue
      used[r] = true
      if (assign(i + 1)) return true
      used[r] = false
    }
    return false
  }
  return assign(0)
}

export function deriveListings(
  rows: PriceRow[],
  listings: Array<{ id: string; items: ListingSignature[] }>
): { matched: string[]; ambiguous: string[][]; unmatched: string[] } {
  if (rows.length === 0) return { matched: [], ambiguous: [], unmatched: [] }

  // 같은 구성(시그니처)의 리스팅이 여러 개면 어느 것인지 사람이 골라야 한다.
  const bySig = new Map<string, string[]>()
  const covered = new Set<string>()
  for (const l of listings) {
    if (!matchesRows(l.items, rows)) continue
    const sig = signatureOf(l.items)
    bySig.set(sig, [...(bySig.get(sig) ?? []), l.id])
    for (const it of l.items) covered.add(it.optionId)
  }

  const matched: string[] = []
  const ambiguous: string[][] = []
  for (const ids of bySig.values()) {
    if (ids.length === 1) matched.push(ids[0])
    else ambiguous.push([...ids].sort())
  }

  // 어느 대상 리스팅에도 등장하지 않는 옵션 — 돌려주지 않으면 반영 대상에서 조용히 빠진다.
  const unmatched = [...new Set(rows.flatMap((r) => r.optionIds))]
    .filter((id) => !covered.has(id))
    .sort()

  return { matched: matched.sort(), ambiguous, unmatched }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/lib/sh/coupang-price/__tests__/listing-derive.test.ts`
Expected: PASS (7 tests). `preview/route.ts` 는 아직 옛 시그니처를 호출해 tsc 가 깨지는데 Task 2 에서 고친다 — 이 태스크에서는 커밋 전에 preview 라우트 호출부만 임시로 `deriveListings([{ optionIds: input.optionIds, quantity: input.quantity }], …)` 로 맞춘다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sh/coupang-price/listing-derive.ts src/lib/sh/coupang-price/__tests__/listing-derive.test.ts app/api/sh/coupang-price/preview/route.ts
git commit -m "✨ feat(coupang-ads): 가격 반영 대상 매칭을 세트(rows)로 일반화"
```

---

### Task 2: 미리보기·반영 공용 대상 계산 + 가격시뮬 rows 전달

**Files:**
- Create: `src/lib/sh/coupang-price/compute-targets.ts`
- Modify: `app/api/sh/coupang-price/preview/route.ts`
- Modify: `src/components/sh/products/pricing-sim/pricing-quick-flow.tsx` (`handleApplyCoupang`, `canApplyCoupang` 전달)
- Modify: `src/components/sh/products/pricing-sim/pricing-channel-board-card.tsx` (비활성 사유)
- Modify: `src/components/sh/products/pricing-sim/coupang-price-apply-dialog.tsx` (`CoupangApplyTarget` 타입·미리보기 요청 본문만)
- Test: `src/lib/sh/coupang-price/__tests__/compute-targets.test.ts`

**Interfaces:**
- Consumes: Task 1 `deriveListings(rows, listings)`, `PriceRow`.
- Produces:
  - `export const priceInputSchema` (zod): `{ channelId: string; rows: PriceRow[] (min 1, 각 optionIds min 1, quantity int>0); salePrice: number>0; minMarginPrice: number>0; includeVat: boolean }`
  - `export type PriceInput = z.infer<typeof priceInputSchema>`
  - `export type ComputedTargets = { channelId: string; channelAxis: 'RG' | 'MP'; targets: PreviewTarget[]; ambiguous: Array<Array<{ id: string; name: string }>>; unmatched: Array<{ id: string; name: string }> }`
  - `export async function computePriceTargets(spaceId: string, input: PriceInput): Promise<ComputedTargets | { error: string; status: number }>`
  - `CoupangApplyTarget` 타입에서 `productId`/`optionIds`/`quantity` 제거, `rows: PriceRow[]` 추가.

- [ ] **Step 1: 실패 테스트 (prisma mock)**

```ts
/** @jest-environment node */
import { computePriceTargets } from '../compute-targets'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    channel: { findFirst: jest.fn() },
    productListing: { findMany: jest.fn() },
    coupangProductItem: { findMany: jest.fn() },
    invProductOption: { findMany: jest.fn() },
  },
}))
const m = prisma as unknown as Record<string, Record<string, jest.Mock>>

const input = {
  channelId: 'ch-rg',
  rows: [{ optionIds: ['A1'], quantity: 1 }],
  salePrice: 19_995,
  minMarginPrice: 15_001,
  includeVat: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  m.channel.findFirst.mockResolvedValue({
    id: 'ch-rg',
    externalSource: 'coupang_rocket_growth',
    representativeChannelId: 'ch-mp',
  })
  m.productListing.findMany.mockResolvedValue([
    { id: 'L1', displayName: '상품 A1', items: [{ optionId: 'A1', quantity: 1 }] },
  ])
  m.coupangProductItem.findMany.mockResolvedValue([
    {
      listingId: 'L1',
      rgVendorItemId: 'rg-1',
      mpVendorItemId: 'mp-1',
      rgSalePrice: 20_000,
      mpSalePrice: 21_000,
      collectedAt: new Date(),
      sellerProductId: 'sp-1',
    },
  ])
  m.invProductOption.findMany.mockResolvedValue([])
})

test('로켓그로스 카드는 대표 채널 리스팅을 RG 축으로 계산한다', async () => {
  const r = await computePriceTargets('space-1', input)
  if ('error' in r) throw new Error(r.error)
  expect(m.productListing.findMany.mock.calls[0][0].where).toEqual({
    spaceId: 'space-1',
    channelId: 'ch-mp',
  })
  expect(r.channelAxis).toBe('RG')
  expect(r.targets[0]).toMatchObject({
    listingId: 'L1',
    vendorItemId: 'rg-1',
    currentPrice: 20_000,
    targetPrice: 20_000, // 19,995 → 10원 반올림
    apMinSalePrice: 15_010, // 15,001 → 10원 올림
    blockedReason: null,
  })
})

test('다른 space 의 채널이면 404', async () => {
  m.channel.findFirst.mockResolvedValue(null)
  expect(await computePriceTargets('space-1', input)).toEqual({
    error: '채널을 찾을 수 없습니다',
    status: 404,
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/lib/sh/coupang-price/__tests__/compute-targets.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `compute-targets.ts` 구현 (preview 라우트 본문 이관)**

```ts
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { deriveListings } from './listing-derive'
import { buildPreviewTargets, type PreviewTarget } from './build-targets'

export const priceInputSchema = z.object({
  channelId: z.string().min(1),
  rows: z
    .array(
      z.object({
        optionIds: z.array(z.string().min(1)).min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  salePrice: z.number().positive(),
  minMarginPrice: z.number().positive(),
  includeVat: z.boolean(),
})
export type PriceInput = z.infer<typeof priceInputSchema>

export type ComputedTargets = {
  channelId: string
  channelAxis: 'RG' | 'MP'
  targets: PreviewTarget[]
  ambiguous: Array<Array<{ id: string; name: string }>>
  unmatched: Array<{ id: string; name: string }>
}

/**
 * 미리보기와 반영이 같은 계산을 쓴다 — 반영 라우트는 클라이언트가 보낸 타깃을 믿지 않고
 * 이 함수로 다시 계산한다(미리보기 이후 매핑이 바뀌었어도 서버 기준이 이긴다).
 */
export async function computePriceTargets(
  spaceId: string,
  input: PriceInput
): Promise<ComputedTargets | { error: string; status: number }> {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, spaceId },
    select: { id: true, externalSource: true, representativeChannelId: true },
  })
  if (!channel) return { error: '채널을 찾을 수 없습니다', status: 404 }

  // 로켓그로스 등 연동 채널은 판매채널 상품을 갖지 않고 대표 채널 것을 미러링한다.
  const listingChannelId = channel.representativeChannelId ?? channel.id
  const channelAxis = channel.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH ? 'RG' : 'MP'

  const listings = await prisma.productListing.findMany({
    where: { spaceId, channelId: listingChannelId },
    select: { id: true, displayName: true, items: { select: { optionId: true, quantity: true } } },
  })
  const derived = deriveListings(
    input.rows,
    listings.map((l) => ({ id: l.id, items: l.items }))
  )
  const nameById = new Map(listings.map((l) => [l.id, l.displayName]))

  const items = await prisma.coupangProductItem.findMany({
    where: { spaceId, listingId: { in: derived.matched } },
    select: {
      listingId: true,
      rgVendorItemId: true,
      mpVendorItemId: true,
      rgSalePrice: true,
      mpSalePrice: true,
      collectedAt: true,
      sellerProductId: true,
    },
  })

  const targets = buildPreviewTargets({
    channelAxis,
    salePrice: input.salePrice,
    minMarginPrice: input.minMarginPrice,
    includeVat: input.includeVat,
    now: new Date(),
    listings: derived.matched.map((id) => ({ id, name: nameById.get(id) ?? '' })),
    items: items
      .filter((i): i is typeof i & { listingId: string } => i.listingId !== null)
      .map((i) => ({ ...i, listingId: i.listingId })),
  })

  // optionIds 는 클라이언트 입력 — product 릴레이션으로 space 스코프를 건다.
  const unmatchedOptions = derived.unmatched.length
    ? await prisma.invProductOption.findMany({
        where: { id: { in: derived.unmatched }, product: { spaceId } },
        select: { id: true, name: true },
      })
    : []

  return {
    channelId: channel.id,
    channelAxis,
    targets,
    ambiguous: derived.ambiguous.map((ids) => ids.map((id) => ({ id, name: nameById.get(id) ?? '' }))),
    unmatched: derived.unmatched.map((id) => ({
      id,
      name: unmatchedOptions.find((o) => o.id === id)?.name ?? id,
    })),
  }
}
```

- [ ] **Step 4: preview 라우트를 얇게**

`app/api/sh/coupang-price/preview/route.ts` 전체 교체:

```ts
import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { computePriceTargets, priceInputSchema } from '@/lib/sh/coupang-price/compute-targets'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const parsed = priceInputSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const r = await computePriceTargets(resolved.space.id, parsed.data)
  if ('error' in r) return errorResponse(r.error, r.status)
  return NextResponse.json({ targets: r.targets, ambiguous: r.ambiguous, unmatched: r.unmatched })
}
```

- [ ] **Step 5: 가격시뮬에서 rows 전달 + 버튼 활성 조건**

`coupang-price-apply-dialog.tsx` 의 `CoupangApplyTarget` 에서 `productId: string`, `optionIds: string[]`, `quantity: number` 세 줄을 지우고 다음을 추가(파일 상단에 `import type { PriceRow } from '@/lib/sh/coupang-price/listing-derive'`):

```ts
  /** 가격시뮬 확정 행 — 행 2개 이상이면 세트 */
  rows: PriceRow[]
```

같은 파일 `loadPreview` 의 요청 본문을:

```ts
          body: JSON.stringify({
            channelId: t.channelId,
            rows: t.rows,
            salePrice: t.salePrice,
            minMarginPrice: t.minMarginPrice,
            includeVat: t.includeVat,
          }),
```

`DialogDescription` 의 `target?.optionIds.length` 를 `target?.rows.length` 기준 문구로: `{target?.channelName} 채널에 {target && target.rows.length > 1 ? '세트' : '옵션'} 가격을 반영합니다.`

`pricing-quick-flow.tsx` `handleApplyCoupang`:

```ts
  // 쿠팡 반영은 기존 상품 모드면 단품·세트 모두 가능하다(행 → 리스팅 구성 매칭).
  // 채널 상품 "생성"의 isSingleProduct 제한과 다르다 — 생성은 단일 상품 옵션만 만든다.
  const canApplyCoupang = mode === 'existing' && confirmedRows.length > 0

  const handleApplyCoupang = useCallback(
    (api: ApiCh, info: CoupangApplyInfo) => {
      if (!canApplyCoupang) {
        toast.error('기존 상품을 먼저 설정해 주세요')
        return
      }
      setCoupangApplyTarget({
        channelId: api.id,
        channelName: api.name,
        listingChannelId: api.representativeChannelId ?? api.id,
        externalSource: api.externalSource ?? null,
        rows: confirmedRows.map((r) => ({ optionIds: r.optionIds, quantity: Math.max(1, r.quantity) })),
        salePrice: info.salePriceBeforeDiscount,
        minMarginPrice: info.recommendedMin,
        includeVat: live.includeVat,
        vatRate: live.vatRate,
        discountRate: info.discountRate,
        promotionLabel: info.promotionLabel,
        costPrice: info.costPrice,
        channelFeePct: info.channelFeePct,
        shippingCost: info.shippingCost,
        targetMargin: info.targetMarginPct,
        minMarginPct: info.minMarginPct,
        computedMargin: info.computedMargin,
      })
    },
    [canApplyCoupang, confirmedRows, live.includeVat, live.vatRate]
  )
```

보드 카드 렌더부의 `canApplyCoupang={canCreate}` 를 `canApplyCoupang={canApplyCoupang}` 로.

`pricing-channel-board-card.tsx` 의 쿠팡 버튼을 툴팁으로 감싼다(이미 `Tooltip*` import 있음). 버튼 JSX 를:

```tsx
        {isCoupangChannel && onApplyCoupang && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* disabled 버튼은 hover 이벤트가 없어 span 으로 감싼다 */}
                <span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={!canApplyCoupang}
                    onClick={() =>
                      onApplyCoupang(channel, {
                        salePriceBeforeDiscount: cell.finalPrice,
                        recommendedMin: floorPrice ?? cell.finalPrice,
                        discountRate: currentDiscount,
                        promotionLabel: hasPromoValue ? promoLabelText : null,
                        costPrice: cell.cogs,
                        channelFeePct,
                        shippingCost: cell.shipping,
                        computedMargin: displayCell.margin,
                        minMarginPct: floorPct,
                        targetMarginPct: target,
                      })
                    }
                  >
                    <Upload className="h-3.5 w-3.5" />
                    쿠팡 판매가로 반영 (₩{fmt(roundPriceTo10(cell.finalPrice))})
                  </Button>
                </span>
              </TooltipTrigger>
              {!canApplyCoupang && (
                <TooltipContent>기존 상품 모드에서 상품을 설정해야 반영할 수 있습니다</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}
```

- [ ] **Step 6: 테스트·타입 확인**

Run: `npx jest src/lib/sh/coupang-price && npx tsc --noEmit -p . 2>&1 | grep "error TS"`
Expected: jest PASS, tsc 는 베이스라인 1건(`next.config.ts`)만.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/sh/coupang-price/compute-targets.ts src/lib/sh/coupang-price/__tests__/compute-targets.test.ts app/api/sh/coupang-price/preview/route.ts src/components/sh/products/pricing-sim/
git commit -m "✨ feat(coupang-ads): 미리보기 대상 계산 공용화 + 가격시뮬 세트(rows) 반영 허용"
```

---

### Task 3: 반영 API(승인 없음) + 채널별 최근 잡 조회

**Files:**
- Create: `app/api/sh/coupang-price/apply/route.ts`
- Create: `app/api/sh/coupang-price/jobs/route.ts`
- Modify: `src/lib/sh/coupang-price/__tests__/price-round.test.ts` (후속과제: half-up 경계)
- Test: `app/api/sh/coupang-price/apply/__tests__/route.test.ts`

**Interfaces:**
- Consumes: Task 2 `priceInputSchema`, `computePriceTargets`; `requireCoupangWorkspaceId(spaceId)` (`src/lib/coupang/workspace-space.ts`); `assertRole(role, 'ADMIN')` (`src/lib/api-helpers.ts`).
- Produces:
  - `POST /api/sh/coupang-price/apply` — 본문 `PriceInput`. 201 `{ job: { id: string; targets: number } }` / 400·403·409(`{ message, jobId }`).
  - 잡 payload 형태(워커 `runPriceChange` 가 읽음 — 변경 금지): `{ channelAxis: 'RG'|'MP'; channelId: string; apActive: true; targets: Array<{ listingId; vendorItemId; listingName; currentPrice: number|null; targetPrice; apMinSalePrice }> }`
  - `GET /api/sh/coupang-price/jobs?channelId=<id>` — 200 `{ job: { id; status: 'PENDING'|'RUNNING'|'SUCCEEDED'|'PARTIAL'|'FAILED'; results: Array<{ listingId; vendorItemId; ok; error: string|null }> | null; error: string|null; createdAt: string; executedAt: string|null; targets: Array<{ listingId; listingName; targetPrice; apMinSalePrice }> } | null }`

- [ ] **Step 1: 실패 테스트**

```ts
/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'
import { computePriceTargets } from '@/lib/sh/coupang-price/compute-targets'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { ...actual, resolveDeckContext: jest.fn() }
})
jest.mock('@/lib/coupang/workspace-space', () => ({
  requireCoupangWorkspaceId: async () => 'ws-1',
}))
jest.mock('@/lib/sh/coupang-price/compute-targets', () => {
  const actual = jest.requireActual('@/lib/sh/coupang-price/compute-targets')
  return { ...actual, computePriceTargets: jest.fn() }
})
jest.mock('@/lib/prisma', () => ({
  prisma: { coupangWriteJob: { findFirst: jest.fn(), create: jest.fn() } },
}))

const job = prisma.coupangWriteJob as unknown as { findFirst: jest.Mock; create: jest.Mock }
const body = {
  channelId: 'ch',
  rows: [{ optionIds: ['A1'], quantity: 1 }],
  salePrice: 20_000,
  minMarginPrice: 15_000,
  includeVat: true,
}
const target = (over: Record<string, unknown> = {}) => ({
  listingId: 'L1',
  listingName: 'A1',
  vendorItemId: 'rg-1',
  currentPrice: 21_000,
  snapshotAgeHours: 1,
  targetPrice: 20_000,
  apMinSalePrice: 15_000,
  deltaPct: -0.05,
  blockedReason: null,
  sellerProductId: 'sp',
  ...over,
})
const call = () =>
  POST(new NextRequest('http://localhost/api/sh/coupang-price/apply', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'space-1' }, role: 'ADMIN' })
  ;(computePriceTargets as jest.Mock).mockResolvedValue({
    channelId: 'ch',
    channelAxis: 'RG',
    targets: [target(), target({ listingId: 'L2', vendorItemId: null, blockedReason: '연결 안 됨' })],
    ambiguous: [],
    unmatched: [],
  })
  job.findFirst.mockResolvedValue(null)
  job.create.mockResolvedValue({ id: 'job-1' })
})

test('반영 가능한 타깃만 담아 apActive=true 잡을 승인 없이 만든다', async () => {
  const res = await call()
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ job: { id: 'job-1', targets: 1 } })
  const data = job.create.mock.calls[0][0].data
  expect(data).toMatchObject({ workspaceId: 'ws-1', spaceId: 'space-1', kind: 'PRICE_CHANGE' })
  expect(data.actionId).toBeUndefined()
  expect(data.payload).toEqual({
    channelAxis: 'RG',
    channelId: 'ch',
    apActive: true,
    targets: [
      { listingId: 'L1', vendorItemId: 'rg-1', listingName: 'A1', currentPrice: 21_000, targetPrice: 20_000, apMinSalePrice: 15_000 },
    ],
  })
})

test('진행 중인 가격 반영 잡이 있으면 409 — 연타·다른 카드 동시 반영 차단', async () => {
  job.findFirst.mockResolvedValue({ id: 'job-0' })
  const res = await call()
  expect(res.status).toBe(409)
  expect(job.create).not.toHaveBeenCalled()
})

test('MEMBER 는 403', async () => {
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'space-1' }, role: 'MEMBER' })
  expect((await call()).status).toBe(403)
})

test('반영 가능한 타깃이 0개면 400', async () => {
  ;(computePriceTargets as jest.Mock).mockResolvedValue({
    channelId: 'ch', channelAxis: 'RG', targets: [target({ blockedReason: 'VAT 미포함' })], ambiguous: [], unmatched: [],
  })
  expect((await call()).status).toBe(400)
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest app/api/sh/coupang-price/apply`
Expected: FAIL — `../route` 없음.

- [ ] **Step 3: 반영 라우트 구현**

`app/api/sh/coupang-price/apply/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'

import { assertRole, errorResponse, resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { requireCoupangWorkspaceId } from '@/lib/coupang/workspace-space'
import { computePriceTargets, priceInputSchema } from '@/lib/sh/coupang-price/compute-targets'

/**
 * POST /api/sh/coupang-price/apply — 승인 없이 쿠팡 가격 반영 잡을 만든다(v1.1 D1).
 * 요청자=승인자=1인 운영이라 미리보기 확인이 곧 승인이다. 대신 API 가 직접
 * ADMIN 역할을 요구한다(승인 채널 구성으로 대신하던 역할 게이트).
 * 실제 쿠팡 호출은 IP allowlist 때문에 워커가 한다 — 여기서는 잡만 만든다.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const denied = assertRole(resolved.role, 'ADMIN')
  if (denied) return denied

  const parsed = priceInputSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const spaceId = resolved.space.id

  // 클라이언트가 보낸 타깃을 믿지 않는다 — 미리보기와 같은 함수로 다시 계산.
  const computed = await computePriceTargets(spaceId, parsed.data)
  if ('error' in computed) return errorResponse(computed.error, computed.status)
  const writable = computed.targets.filter(
    (t): t is typeof t & { vendorItemId: string } => t.blockedReason == null && t.vendorItemId != null
  )
  if (writable.length === 0) return errorResponse('반영 가능한 대상이 없습니다', 400)

  let workspaceId: string
  try {
    workspaceId = await requireCoupangWorkspaceId(spaceId)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : '쿠팡 연동이 없습니다', 400)
  }

  // ponytail: check-then-create 라 동시 두 요청이 둘 다 통과할 수 있다. 가격 PUT 은
  // 자연 멱등이라 결과는 같고 잡만 하나 더 생긴다. 막으려면 부분 unique 인덱스.
  const running = await prisma.coupangWriteJob.findFirst({
    where: { spaceId, kind: 'PRICE_CHANGE', status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  })
  if (running) {
    return errorResponse('진행 중인 쿠팡 가격 반영이 있습니다. 끝난 뒤 다시 시도하세요', 409, {
      jobId: running.id,
    })
  }

  const job = await prisma.coupangWriteJob.create({
    data: {
      workspaceId,
      spaceId,
      kind: 'PRICE_CHANGE',
      payload: {
        channelAxis: computed.channelAxis,
        channelId: computed.channelId,
        // v1.1 D3 — 사용자는 주력 상품 자동조정을 전부 켜고 운영한다. 현재 상태를 읽을
        // API 가 없고 apMinSalePrice 와 함께 보내야 하므로 항상 켠다.
        apActive: true,
        targets: writable.map((t) => ({
          listingId: t.listingId,
          vendorItemId: t.vendorItemId,
          listingName: t.listingName,
          currentPrice: t.currentPrice,
          targetPrice: t.targetPrice,
          apMinSalePrice: t.apMinSalePrice,
        })),
      },
    },
    select: { id: true },
  })

  return NextResponse.json({ job: { id: job.id, targets: writable.length } }, { status: 201 })
}
```

(`errorResponse(message, status, extra)` 는 `src/lib/api-helpers.ts:10` 에 있다 — `extra` 가 본문에 펼쳐진다.)

- [ ] **Step 4: 통과 확인**

Run: `npx jest app/api/sh/coupang-price/apply`
Expected: PASS (4 tests).

- [ ] **Step 5: 채널별 최근 잡 조회 라우트**

`app/api/sh/coupang-price/jobs/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/sh/coupang-price/jobs?channelId= — 해당 채널 카드의 가장 최근 가격 반영 잡.
 * 다이얼로그가 반영 후 폴링하고, 다시 열었을 때 놓친 결과를 보여주는 유일한 경로다.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const channelId = req.nextUrl.searchParams.get('channelId')
  if (!channelId) return errorResponse('channelId 가 필요합니다', 400)

  const job = await prisma.coupangWriteJob.findFirst({
    where: {
      spaceId: resolved.space.id,
      kind: 'PRICE_CHANGE',
      payload: { path: ['channelId'], equals: channelId },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, results: true, error: true, createdAt: true, executedAt: true, payload: true },
  })
  if (!job) return NextResponse.json({ job: null })

  const payload = job.payload as {
    targets: Array<{ listingId: string; listingName: string; targetPrice: number; apMinSalePrice: number }>
  }
  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      results: job.results,
      error: job.error,
      createdAt: job.createdAt,
      executedAt: job.executedAt,
      targets: payload.targets.map((t) => ({
        listingId: t.listingId,
        listingName: t.listingName,
        targetPrice: t.targetPrice,
        apMinSalePrice: t.apMinSalePrice,
      })),
    },
  })
}
```

- [ ] **Step 6: 후속과제 — 10원 반올림 half-up 경계 테스트**

`src/lib/sh/coupang-price/__tests__/price-round.test.ts` 끝에 추가:

```ts
test('10원 반올림은 5에서 올린다(half-up) — 돈 경계 고정', () => {
  expect(roundPriceTo10(19_995)).toBe(20_000)
  expect(roundPriceTo10(19_994)).toBe(19_990)
  expect(ceilMinPriceTo10(15_001)).toBe(15_010)
  expect(ceilMinPriceTo10(15_000)).toBe(15_000)
})
```

(파일 상단 import 에 `roundPriceTo10`, `ceilMinPriceTo10` 이 없으면 추가.)

Run: `npx jest src/lib/sh/coupang-price app/api/sh/coupang-price`
Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add app/api/sh/coupang-price/apply app/api/sh/coupang-price/jobs src/lib/sh/coupang-price/__tests__/price-round.test.ts
git commit -m "✨ feat(coupang-ads): 쿠팡 가격 반영을 승인 없이 잡으로 바로 생성 + 채널별 최근 잡 조회"
```

---

### Task 4: 워커 결과 보고 — 판매자배송 판매가 동기화 + status 검증, Slack 제거

**Files:**
- Modify: `app/api/coupang/write-jobs/[jobId]/report/route.ts`
- Test: `app/api/coupang/write-jobs/[jobId]/report/__tests__/route.test.ts`

**Interfaces:**
- Consumes: 워커 보고 본문 `{ status: 'SUCCEEDED'|'PARTIAL'|'FAILED'; results?: Array<{ listingId; vendorItemId; ok; error }>; error?: string }` (변경 없음), `resolveCollectionAuth`.
- Produces: 동작 — MP 축 성공 타깃만 `ProductListing.retailPrice = targetPrice`.

- [ ] **Step 1: 실패 테스트**

```ts
/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/collection/resolve-workspace', () => ({
  resolveCollectionAuth: async () => ({ kind: 'worker', workspaceId: 'ws-1' }),
}))
jest.mock('@/lib/prisma', () => {
  const tx = {
    coupangProductItem: { updateMany: jest.fn() },
    productListing: { updateMany: jest.fn() },
  }
  return {
    prisma: {
      coupangWriteJob: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  }
})
const p = prisma as unknown as {
  coupangWriteJob: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock }
  __tx: { coupangProductItem: { updateMany: jest.Mock }; productListing: { updateMany: jest.Mock } }
}

const report = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ jobId: 'job-1' }),
  })
const jobWith = (channelAxis: 'RG' | 'MP') => ({
  id: 'job-1',
  spaceId: 'space-1',
  kind: 'PRICE_CHANGE',
  payload: {
    channelAxis,
    targets: [
      { listingId: 'L1', targetPrice: 20_000 },
      { listingId: 'L2', targetPrice: 20_000 },
    ],
  },
})
const results = [
  { listingId: 'L1', vendorItemId: 'v1', ok: true, error: null },
  { listingId: 'L2', vendorItemId: 'v2', ok: false, error: '쿠팡 거부' },
]

beforeEach(() => {
  jest.clearAllMocks()
  p.coupangWriteJob.updateMany.mockResolvedValue({ count: 1 })
})

test('판매자배송 축 성공 타깃만 워크덱 판매가를 갱신한다', async () => {
  p.coupangWriteJob.findUniqueOrThrow.mockResolvedValue(jobWith('MP'))
  await report({ status: 'PARTIAL', results })
  expect(p.__tx.productListing.updateMany).toHaveBeenCalledTimes(1)
  expect(p.__tx.productListing.updateMany).toHaveBeenCalledWith({
    where: { id: 'L1', spaceId: 'space-1' },
    data: { retailPrice: 20_000 },
  })
})

test('로켓그로스 축은 워크덱 판매가를 건드리지 않는다', async () => {
  p.coupangWriteJob.findUniqueOrThrow.mockResolvedValue(jobWith('RG'))
  await report({ status: 'PARTIAL', results })
  expect(p.__tx.productListing.updateMany).not.toHaveBeenCalled()
  expect(p.__tx.coupangProductItem.updateMany).toHaveBeenCalledWith({
    where: { spaceId: 'space-1', listingId: 'L1' },
    data: { rgSalePrice: 20_000 },
  })
})

test('알 수 없는 status 는 400 — 500 이면 워커가 보고 실패로 보고 잡이 RUNNING 에 갇힌다', async () => {
  const res = await report({ status: 'DONE', results })
  expect(res.status).toBe(400)
  expect(p.coupangWriteJob.updateMany).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest "app/api/coupang/write-jobs"`
Expected: FAIL — `productListing.updateMany` 미호출, status 검증 없음.

- [ ] **Step 3: 구현**

라우트에서 `import { notifyWriteJobResult } …` 줄과 `await notifyWriteJobResult(jobId)` 줄을 삭제하고, 상단 주석의 "Slack 알림까지 여기서 체이닝한다"를 "MP 축 성공 타깃은 워크덱 판매가(ProductListing.retailPrice)도 갱신한다(v1.1 D4)."로 바꾼다. `const body = …` 다음에 검증 추가:

```ts
  if (!['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(body.status)) {
    return errorResponse(`알 수 없는 status: ${String(body.status)}`, 400)
  }
```

스냅샷 갱신 블록을 트랜잭션으로 교체:

```ts
  if (job.kind === 'PRICE_CHANGE' && body.results?.length) {
    const payload = job.payload as {
      channelAxis: 'RG' | 'MP'
      targets: Array<{ listingId: string; targetPrice: number }>
    }
    const succeeded = body.results
      .filter((r) => r.ok)
      .map((r) => payload.targets.find((t) => t.listingId === r.listingId))
      .filter((t): t is { listingId: string; targetPrice: number } => t != null)

    await prisma.$transaction(async (tx) => {
      for (const t of succeeded) {
        await tx.coupangProductItem.updateMany({
          where: { spaceId: job.spaceId, listingId: t.listingId },
          data: payload.channelAxis === 'RG' ? { rgSalePrice: t.targetPrice } : { mpSalePrice: t.targetPrice },
        })
        // 워크덱 리스팅은 판매자배송 채널에 1개이고 로켓그로스는 그것을 미러링한다.
        // 쿠팡 가격 2개 중 리스팅 판매가로 맞출 수 있는 건 MP 축뿐이다(RG 가격은 쿠팡에만 존재).
        if (payload.channelAxis === 'MP') {
          await tx.productListing.updateMany({
            where: { id: t.listingId, spaceId: job.spaceId },
            data: { retailPrice: t.targetPrice },
          })
        }
      }
    })
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest "app/api/coupang/write-jobs"`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add "app/api/coupang/write-jobs/[jobId]/report"
git commit -m "✨ feat(coupang-ads): 판매자배송 반영 성공 시 워크덱 판매가 동기화 + 보고 status 검증"
```

---

### Task 5: 승인 액션·Slack 결과 알림 제거

**Files:**
- Delete: `src/lib/agent/actions/coupang-price.ts`, `src/lib/agent/actions/__tests__/coupang-price.e2e.test.ts`, `src/lib/slack/notify-write-job-result.ts`, `src/lib/slack/__tests__/notify-write-job-result.test.ts`
- Modify: `src/lib/agent/actions/registry.ts`

**Interfaces:**
- Consumes: Task 4 에서 report 라우트의 `notifyWriteJobResult` 참조가 이미 제거됨.
- Produces: 없음. 승인 만료 게이트·`validateCreate`·`expiryHours` 등 공용 개선(`create.ts`/`execute.ts`/`types.ts`/승인 시트 EXPIRED 표시)은 **유지**.

- [ ] **Step 1: 참조 확인**

Run: `grep -rn "coupangPriceChange\|coupang-price.change\|notifyWriteJobResult" src app worker/src`
Expected: `registry.ts` 와 삭제 대상 파일, 다이얼로그(`'seller-hub.coupang-price.change'` — Task 6 에서 제거)만.

- [ ] **Step 2: 삭제·등록 해제**

```bash
git rm src/lib/agent/actions/coupang-price.ts src/lib/agent/actions/__tests__/coupang-price.e2e.test.ts src/lib/slack/notify-write-job-result.ts src/lib/slack/__tests__/notify-write-job-result.test.ts
```

`registry.ts` 에서 `coupangPriceChange` import 줄과 등록 항목 줄을 지운다.

- [ ] **Step 3: 타입 확인**

Run: `npx tsc --noEmit -p . 2>&1 | grep "error TS"`
Expected: 베이스라인 1건 + 다이얼로그가 아직 `APPROVALS_PATH` 등을 쓰는 것은 문제없음(파일은 존재). 새 에러 0.

- [ ] **Step 4: 커밋**

```bash
git add -A src/lib/agent/actions/registry.ts
git commit -m "🔥 remove(coupang-ads): 가격 반영 승인 액션·Slack 결과 알림 제거 (승인 없이 바로 반영)"
```

---

### Task 6: 반영 다이얼로그 — 자동조정 고정 표시, 바로 반영, 결과 폴링

**Files:**
- Modify: `src/components/sh/products/pricing-sim/coupang-price-apply-dialog.tsx`

**Interfaces:**
- Consumes: Task 3 `POST /api/sh/coupang-price/apply` → `{ job: { id, targets } }`, `GET /api/sh/coupang-price/jobs?channelId=` → `{ job }`; Task 7 경로 상수 `SELLER_HUB_COUPANG_MATCHING_PATH`(Task 8 에서 추가 — 이 태스크에서는 `src/lib/deck-routes.ts` 에 먼저 추가한다: `export const SELLER_HUB_COUPANG_MATCHING_PATH = \`${SELLER_HUB_BASE_PATH}/products/listings/coupang-matching\``).
- Produces: UI 만.

- [ ] **Step 1: 상태·제출 교체**

파일에서 `Checkbox` import, `APPROVALS_PATH` import, `apActive` state 와 그 `setApActive(true)` 호출, 체크박스 블록(`<div className="rounded-md border bg-muted/30 …">…</div>`), 하단 `승인 큐 바로가기` Link 를 지운다. 다음 타입·state·함수를 추가/교체:

```ts
type JobView = {
  id: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
  results: Array<{ listingId: string; vendorItemId: string; ok: boolean; error: string | null }> | null
  error: string | null
  createdAt: string
  executedAt: string | null
  targets: Array<{ listingId: string; listingName: string; targetPrice: number; apMinSalePrice: number }>
}

const POLL_MS = 2_000
const POLL_LIMIT_MS = 3 * 60_000
const isDone = (s: JobView['status']) => s === 'SUCCEEDED' || s === 'PARTIAL' || s === 'FAILED'
```

컴포넌트 안:

```ts
  const [job, setJob] = useState<JobView | null>(null)
  const [pollStartedAt, setPollStartedAt] = useState<number | null>(null)

  const fetchLatestJob = useCallback(async (channelId: string): Promise<JobView | null> => {
    const res = await fetch(`/api/sh/coupang-price/jobs?channelId=${encodeURIComponent(channelId)}`)
    const data = await res.json().catch(() => ({}))
    return res.ok ? ((data as { job: JobView | null }).job ?? null) : null
  }, [])

  // 열 때 미리보기와 함께 이 채널의 최근 반영 결과를 불러온다(닫은 사이 끝난 결과 확인용).
  useEffect(() => {
    if (!target) {
      setJob(null)
      setPollStartedAt(null)
      return
    }
    void fetchLatestJob(target.channelId).then((j) => {
      setJob(j)
      if (j && !isDone(j.status)) setPollStartedAt(Date.now())
    })
  }, [target, fetchLatestJob])

  // 진행 중이면 2초 간격 폴링, 3분에서 멈춘다(워커 중단 의심 안내).
  useEffect(() => {
    if (!target || !job || isDone(job.status) || pollStartedAt == null) return
    if (Date.now() - pollStartedAt > POLL_LIMIT_MS) return
    const t = setTimeout(async () => {
      const next = await fetchLatestJob(target.channelId)
      if (next) setJob(next)
      if (next && isDone(next.status)) void loadPreview(target)
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [target, job, pollStartedAt, fetchLatestJob, loadPreview])

  const pollTimedOut =
    job != null && !isDone(job.status) && pollStartedAt != null && Date.now() - pollStartedAt > POLL_LIMIT_MS

  async function handleSubmit() {
    if (!target) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/sh/coupang-price/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: target.channelId,
          rows: target.rows,
          salePrice: target.salePrice,
          minMarginPrice: target.minMarginPrice,
          includeVat: target.includeVat,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? `반영 요청 실패 (HTTP ${res.status})`)
      setJob(await fetchLatestJob(target.channelId))
      setPollStartedAt(Date.now())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반영 요청 실패')
    } finally {
      setSubmitting(false)
    }
  }

  const inFlight = job != null && !isDone(job.status) && !pollTimedOut
```

`useCallback` 을 react import 에 추가. `DialogDescription` 문구에서 "승인 큐에 등록되며, 실제 반영은 승인 후 워커가 실행합니다." 를 "확인하면 바로 쿠팡에 반영됩니다(보통 1분 안)." 로.

- [ ] **Step 2: 자동조정 안내·표 컬럼·결과 블록**

할인 경고 블록 다음에 자동조정 안내(체크박스 자리):

```tsx
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="font-medium">자동 가격조정 켜짐</span>
            <span className="ml-2 text-muted-foreground">
              최저가는 최소마진 {target ? (target.minMarginPct * 100).toFixed(0) : 0}% 기준으로
              옵션마다 설정됩니다
            </span>
            <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              꺼져 있던 옵션도 자동조정이 켜지고, Wing 에서 정한 최저가는 아래 값으로 바뀝니다.
            </p>
          </div>
```

표 헤더 `<TableHead className="text-right">목표가</TableHead>` 다음에 `<TableHead className="text-right">자동조정 최저가</TableHead>` 를 넣고, 행의 목표가 셀 다음에:

```tsx
                      <TableCell className="text-right tabular-nums">₩{fmt(t.apMinSalePrice)}</TableCell>
```

`colSpan={6}` 두 곳을 `colSpan={7}` 로.

표 아래(Footer 위)에 결과 블록:

```tsx
          {job && (
            <div className="rounded-md border px-3 py-2 text-sm">
              <p className="font-medium">
                {inFlight
                  ? '쿠팡에 반영 중…'
                  : pollTimedOut
                    ? '워커가 아직 처리하지 않았습니다 — 워커가 멈췄을 수 있습니다'
                    : job.status === 'SUCCEEDED'
                      ? '최근 반영: 모두 성공'
                      : job.status === 'PARTIAL'
                        ? '최근 반영: 일부 실패'
                        : '최근 반영: 실패'}
                <span className="ml-2 text-xs text-muted-foreground">
                  {new Date(job.createdAt).toLocaleString('ko-KR')}
                </span>
              </p>
              {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
              {job.results && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {job.results.map((r) => {
                    const t = job.targets.find((x) => x.listingId === r.listingId)
                    return (
                      <li key={r.listingId} className={r.ok ? 'text-emerald-700' : 'text-destructive'}>
                        {t?.listingName ?? r.listingId} —{' '}
                        {r.ok ? `₩${fmt(t?.targetPrice ?? 0)} 반영` : `실패: ${r.error ?? '알 수 없음'}`}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
```

매칭 안내 링크(ambiguous 블록 아래):

```tsx
          <Link href={SELLER_HUB_COUPANG_MATCHING_PATH} className="text-xs text-muted-foreground underline">
            쿠팡 상품 매칭 관리
          </Link>
```

Footer 반영 버튼:

```tsx
            <Button onClick={handleSubmit} disabled={submitting || loading || inFlight || writableCount === 0}>
              {submitting ? '요청 중...' : inFlight ? '반영 중...' : `쿠팡에 반영 (${writableCount}개)`}
            </Button>
```

- [ ] **Step 3: 타입·린트**

Run: `npx tsc --noEmit -p . 2>&1 | grep "error TS"; npx eslint src/components/sh/products/pricing-sim/coupang-price-apply-dialog.tsx src/lib/deck-routes.ts`
Expected: 베이스라인 1건, eslint 에러 0.

- [ ] **Step 4: 커밋**

```bash
git add src/components/sh/products/pricing-sim/coupang-price-apply-dialog.tsx src/lib/deck-routes.ts
git commit -m "✨ feat(coupang-ads): 반영 다이얼로그 — 승인 없이 반영·결과 폴링·자동조정 고정 표시"
```

---

### Task 7: 자동 매칭 후보 계산 + 매칭 API

**Files:**
- Create: `src/lib/sh/coupang-price/match-candidates.ts`
- Create: `src/lib/sh/coupang-price/load-matching.ts`
- Create: `src/lib/sh/coupang-price/link-item.ts`
- Create: `app/api/sh/coupang-price/matching/route.ts`
- Create: `app/api/sh/coupang-price/matching/confirm/route.ts`
- Create: `app/api/sh/coupang-price/sync/route.ts`
- Modify: `app/api/sh/coupang-price/link/route.ts` (POST 는 `linkCoupangItem` 사용, DELETE 추가)
- Test: `src/lib/sh/coupang-price/__tests__/match-candidates.test.ts`

**Interfaces:**
- Consumes: Task 1 `signatureOf`, `ListingSignature`; `resolveCoupangWorkspaceForSpace(spaceId)` → `{ workspaceId, locationId } | null` (`src/lib/inv/resolve-coupang-workspace.ts`).
- Produces:
  - `export type MatchStatus = 'CONFIRMED' | 'NEEDS_REVIEW' | 'CANDIDATE' | 'AMBIGUOUS' | 'NONE'`
  - `export function computeMatchCandidates(args: { items: Array<{ id: string; rgVendorItemId: string | null; listingId: string | null }>; skuByVendorItemId: Map<string, string>; compositionBySku: Map<string, ListingSignature[]>; listings: Array<{ id: string; items: ListingSignature[] }> }): Map<string, { status: MatchStatus; candidateListingIds: string[] }>`
  - `export async function loadMatchingRows(spaceId: string): Promise<MatchingRow[]>` where `MatchingRow = { id; itemName: string|null; sellerProductId; rgVendorItemId: string|null; mpVendorItemId: string|null; rgSalePrice: number|null; mpSalePrice: number|null; collectedAt: string; status: MatchStatus; listing: { id; name } | null; candidates: Array<{ id; name }> }`
  - `export async function linkCoupangItem(spaceId: string, coupangProductItemId: string, listingId: string): Promise<{ ok: true } | { ok: false; reason: string; status: number }>`
  - `GET /api/sh/coupang-price/matching` → `{ rows: MatchingRow[] }`
  - `POST /api/sh/coupang-price/matching/confirm` body `{ pairs: Array<{ coupangProductItemId; listingId }> }` → `{ confirmed: number; skipped: Array<{ coupangProductItemId; reason }> }`
  - `DELETE /api/sh/coupang-price/link` body `{ coupangProductItemId }` → `{ ok: true }`
  - `POST /api/sh/coupang-price/sync` → 201 `{ job: { id } }` / 409

- [ ] **Step 1: 실패 테스트 (순수 함수)**

```ts
import { computeMatchCandidates } from '../match-candidates'

const listings = [
  { id: 'L-A1', items: [{ optionId: 'A1', quantity: 1 }] },
  { id: 'L-SET', items: [{ optionId: 'A1', quantity: 1 }, { optionId: 'B1', quantity: 2 }] },
  { id: 'L-B1a', items: [{ optionId: 'B1', quantity: 1 }] },
  { id: 'L-B1b', items: [{ optionId: 'B1', quantity: 1 }] },
]
const skuByVendorItemId = new Map([
  ['rg-a1', 'sku-a1'],
  ['rg-set', 'sku-set'],
  ['rg-b1', 'sku-b1'],
])
const compositionBySku = new Map([
  ['sku-a1', [{ optionId: 'A1', quantity: 1 }]],
  ['sku-set', [{ optionId: 'B1', quantity: 2 }, { optionId: 'A1', quantity: 1 }]],
  ['sku-b1', [{ optionId: 'B1', quantity: 1 }]],
])
const run = (items: Array<{ id: string; rgVendorItemId: string | null; listingId: string | null }>) =>
  computeMatchCandidates({ items, skuByVendorItemId, compositionBySku, listings })

test('재고 매핑 구성과 같은 리스팅 1개 → 후보 (세트 포함)', () => {
  const r = run([
    { id: 'i1', rgVendorItemId: 'rg-a1', listingId: null },
    { id: 'i2', rgVendorItemId: 'rg-set', listingId: null },
  ])
  expect(r.get('i1')).toEqual({ status: 'CANDIDATE', candidateListingIds: ['L-A1'] })
  expect(r.get('i2')).toEqual({ status: 'CANDIDATE', candidateListingIds: ['L-SET'] })
})

test('같은 구성 리스팅 2개 → 모호', () => {
  expect(run([{ id: 'i', rgVendorItemId: 'rg-b1', listingId: null }]).get('i')).toEqual({
    status: 'AMBIGUOUS',
    candidateListingIds: ['L-B1a', 'L-B1b'],
  })
})

test('RG 축이 없거나 재고 매핑이 없으면 없음(수동)', () => {
  const r = run([
    { id: 'mp-only', rgVendorItemId: null, listingId: null },
    { id: 'no-sku', rgVendorItemId: 'rg-unknown', listingId: null },
  ])
  expect(r.get('mp-only')).toEqual({ status: 'NONE', candidateListingIds: [] })
  expect(r.get('no-sku')).toEqual({ status: 'NONE', candidateListingIds: [] })
})

test('확정된 매칭은 덮지 않는다 — 후보가 다르면 확인 필요만 표시', () => {
  const r = run([
    { id: 'same', rgVendorItemId: 'rg-a1', listingId: 'L-A1' },
    { id: 'diff', rgVendorItemId: 'rg-a1', listingId: 'L-SET' },
    { id: 'manual', rgVendorItemId: null, listingId: 'L-A1' },
  ])
  expect(r.get('same')).toEqual({ status: 'CONFIRMED', candidateListingIds: ['L-A1'] })
  expect(r.get('diff')).toEqual({ status: 'NEEDS_REVIEW', candidateListingIds: ['L-A1'] })
  expect(r.get('manual')).toEqual({ status: 'CONFIRMED', candidateListingIds: [] })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/lib/sh/coupang-price/__tests__/match-candidates.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `match-candidates.ts` 구현**

```ts
import { signatureOf, type ListingSignature } from './listing-derive'

export type MatchStatus = 'CONFIRMED' | 'NEEDS_REVIEW' | 'CANDIDATE' | 'AMBIGUOUS' | 'NONE'

/**
 * 쿠팡 옵션 → 워크덱 리스팅 자동 후보.
 *
 *   rgVendorItemId(=재고 optionId) → skuId → 로켓그로스 재고 매핑 구성 → 같은 구성 리스팅
 *
 * 재고 매핑은 재고 대조용으로 사람이 확정한 값이라 신뢰할 수 있다. RG 축이 없는
 * 판매자배송 전용 옵션은 이 경로가 없어 수동이다. 확정된 매칭(listingId)은 절대 덮지 않고,
 * 후보가 다른 리스팅을 가리키면 확인 필요로만 표시한다(재고 매핑·리스팅 구성 변경 신호).
 * 상태는 저장하지 않고 조회 시 계산한다 — 저장하면 매핑 변경마다 무효화가 필요하다.
 */
export function computeMatchCandidates(args: {
  items: Array<{ id: string; rgVendorItemId: string | null; listingId: string | null }>
  skuByVendorItemId: Map<string, string>
  compositionBySku: Map<string, ListingSignature[]>
  listings: Array<{ id: string; items: ListingSignature[] }>
}): Map<string, { status: MatchStatus; candidateListingIds: string[] }> {
  const listingsBySig = new Map<string, string[]>()
  for (const l of args.listings) {
    if (l.items.length === 0) continue
    const sig = signatureOf(l.items)
    listingsBySig.set(sig, [...(listingsBySig.get(sig) ?? []), l.id])
  }

  const out = new Map<string, { status: MatchStatus; candidateListingIds: string[] }>()
  for (const item of args.items) {
    const sku = item.rgVendorItemId ? args.skuByVendorItemId.get(item.rgVendorItemId) : undefined
    const composition = sku ? args.compositionBySku.get(sku) : undefined
    const candidates = composition ? [...(listingsBySig.get(signatureOf(composition)) ?? [])].sort() : []

    let status: MatchStatus
    if (item.listingId) {
      status =
        candidates.length === 1 && candidates[0] !== item.listingId ? 'NEEDS_REVIEW' : 'CONFIRMED'
    } else if (candidates.length === 1) status = 'CANDIDATE'
    else if (candidates.length > 1) status = 'AMBIGUOUS'
    else status = 'NONE'

    out.set(item.id, { status, candidateListingIds: candidates })
  }
  return out
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/lib/sh/coupang-price/__tests__/match-candidates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: 로더 `load-matching.ts`**

```ts
import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { computeMatchCandidates, type MatchStatus } from './match-candidates'

export type MatchingRow = {
  id: string
  itemName: string | null
  sellerProductId: string
  rgVendorItemId: string | null
  mpVendorItemId: string | null
  rgSalePrice: number | null
  mpSalePrice: number | null
  collectedAt: string
  status: MatchStatus
  listing: { id: string; name: string } | null
  candidates: Array<{ id: string; name: string }>
}

const STATUS_ORDER: Record<MatchStatus, number> = {
  NEEDS_REVIEW: 0,
  CANDIDATE: 1,
  AMBIGUOUS: 2,
  NONE: 3,
  CONFIRMED: 4,
}

export async function loadMatchingRows(spaceId: string): Promise<MatchingRow[]> {
  const items = await prisma.coupangProductItem.findMany({
    where: { spaceId },
    select: {
      id: true,
      itemName: true,
      sellerProductId: true,
      rgVendorItemId: true,
      mpVendorItemId: true,
      rgSalePrice: true,
      mpSalePrice: true,
      collectedAt: true,
      listingId: true,
    },
  })
  if (items.length === 0) return []

  // 쿠팡 리스팅 채널 = 로켓그로스 채널의 대표 채널(판매자배송). 대표가 없으면 RG 채널 자신.
  const rgChannel = await prisma.channel.findFirst({
    where: { spaceId, externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH },
    select: { id: true, representativeChannelId: true },
  })
  const listingChannelId = rgChannel ? (rgChannel.representativeChannelId ?? rgChannel.id) : null
  const listings = listingChannelId
    ? await prisma.productListing.findMany({
        where: { spaceId, channelId: listingChannelId },
        select: { id: true, displayName: true, items: { select: { optionId: true, quantity: true } } },
      })
    : []

  // vendorItemId(=재고 optionId) → skuId : 최신 재고건전성 스냅샷에서.
  const ws = await resolveCoupangWorkspaceForSpace(spaceId)
  const skuByVendorItemId = new Map<string, string>()
  const compositionBySku = new Map<string, Array<{ optionId: string; quantity: number }>>()
  if (ws) {
    const latest = await prisma.inventoryRecord.findFirst({
      where: { workspaceId: ws.workspaceId, fileType: 'INVENTORY_HEALTH' },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    if (latest) {
      const records = await prisma.inventoryRecord.findMany({
        where: { workspaceId: ws.workspaceId, fileType: 'INVENTORY_HEALTH', snapshotDate: latest.snapshotDate },
        select: { optionId: true, skuId: true },
      })
      for (const r of records) if (r.optionId && r.skuId) skuByVendorItemId.set(String(r.optionId), String(r.skuId))
    }
    const maps = await prisma.invLocationProductMap.findMany({
      where: { locationId: ws.locationId },
      select: { externalCode: true, items: { select: { optionId: true, quantity: true } } },
    })
    for (const m of maps) compositionBySku.set(m.externalCode, m.items)
  }

  const computed = computeMatchCandidates({
    items,
    skuByVendorItemId,
    compositionBySku,
    listings: listings.map((l) => ({ id: l.id, items: l.items })),
  })
  const nameById = new Map(listings.map((l) => [l.id, l.displayName]))
  // 확정 리스팅이 다른 채널(대표 채널 변경 등)이면 이름을 따로 가져온다.
  const missing = items.filter((i) => i.listingId && !nameById.has(i.listingId)).map((i) => i.listingId!)
  if (missing.length) {
    const extra = await prisma.productListing.findMany({
      where: { id: { in: missing }, spaceId },
      select: { id: true, displayName: true },
    })
    for (const l of extra) nameById.set(l.id, l.displayName)
  }

  return items
    .map((i) => {
      const c = computed.get(i.id)!
      return {
        id: i.id,
        itemName: i.itemName,
        sellerProductId: i.sellerProductId,
        rgVendorItemId: i.rgVendorItemId,
        mpVendorItemId: i.mpVendorItemId,
        rgSalePrice: i.rgSalePrice,
        mpSalePrice: i.mpSalePrice,
        collectedAt: i.collectedAt.toISOString(),
        status: c.status,
        listing: i.listingId ? { id: i.listingId, name: nameById.get(i.listingId) ?? i.listingId } : null,
        candidates: c.candidateListingIds.map((id) => ({ id, name: nameById.get(id) ?? id })),
      }
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.itemName ?? '').localeCompare(b.itemName ?? ''))
}
```

`InventoryRecord.optionId`/`skuId` 컬럼 타입을 먼저 확인: `grep -n "model InventoryRecord" -A15 prisma/schema.prisma`. 문자열이면 `String()` 감싸기는 무해하다(재고 API 가 숫자로 주던 함정 방어 — 메모리 `project_coupang_open_api_source`).

- [ ] **Step 6: `link-item.ts` 로 연결 검증 추출 + link 라우트 POST/DELETE**

`src/lib/sh/coupang-price/link-item.ts`:

```ts
import { prisma } from '@/lib/prisma'

/**
 * 쿠팡 옵션 ↔ 리스팅 연결. 양방향 모두 기존 확정을 조용히 덮지 않는다 —
 * 재연결하려면 먼저 해제해야 한다(listingId 는 @unique 라 덮으면 기존 연결이 끊긴다).
 */
export async function linkCoupangItem(
  spaceId: string,
  coupangProductItemId: string,
  listingId: string
): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  const listing = await prisma.productListing.findFirst({ where: { id: listingId, spaceId }, select: { id: true } })
  if (!listing) return { ok: false, reason: '판매채널 상품을 찾을 수 없습니다', status: 404 }

  const item = await prisma.coupangProductItem.findFirst({
    where: { id: coupangProductItemId, spaceId },
    select: { id: true, listingId: true },
  })
  if (!item) return { ok: false, reason: '쿠팡 옵션을 찾을 수 없습니다', status: 404 }
  if (item.listingId === listingId) return { ok: true }
  if (item.listingId) return { ok: false, reason: '이미 다른 판매채널 상품에 연결된 쿠팡 옵션입니다', status: 400 }

  const conflicting = await prisma.coupangProductItem.findFirst({
    where: { listingId, spaceId, NOT: { id: coupangProductItemId } },
    select: { id: true },
  })
  if (conflicting) return { ok: false, reason: '이미 다른 쿠팡 옵션이 연결된 판매채널 상품입니다', status: 400 }

  await prisma.coupangProductItem.update({ where: { id: coupangProductItemId }, data: { listingId } })
  return { ok: true }
}
```

`app/api/sh/coupang-price/link/route.ts` 전체 교체:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { linkCoupangItem } from '@/lib/sh/coupang-price/link-item'

const linkBodySchema = z.object({
  listingId: z.string().min(1),
  coupangProductItemId: z.string().min(1),
})
const unlinkBodySchema = z.object({ coupangProductItemId: z.string().min(1) })

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const parsed = linkBodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const r = await linkCoupangItem(resolved.space.id, parsed.data.coupangProductItemId, parsed.data.listingId)
  if (!r.ok) return errorResponse(r.reason, r.status)
  return NextResponse.json({ ok: true })
}

// 연결 해제 — 잘못 확정한 매칭을 되돌리는 유일한 경로(v1.1 §7.2).
export async function DELETE(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const parsed = unlinkBodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return errorResponse('coupangProductItemId 가 필요합니다', 400)
  const r = await prisma.coupangProductItem.updateMany({
    where: { id: parsed.data.coupangProductItemId, spaceId: resolved.space.id },
    data: { listingId: null },
  })
  if (r.count === 0) return errorResponse('쿠팡 옵션을 찾을 수 없습니다', 404)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 7: matching·confirm·sync 라우트**

`app/api/sh/coupang-price/matching/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { loadMatchingRows } from '@/lib/sh/coupang-price/load-matching'

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  return NextResponse.json({ rows: await loadMatchingRows(resolved.space.id) })
}
```

`app/api/sh/coupang-price/matching/confirm/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { linkCoupangItem } from '@/lib/sh/coupang-price/link-item'

const bodySchema = z.object({
  pairs: z
    .array(z.object({ coupangProductItemId: z.string().min(1), listingId: z.string().min(1) }))
    .min(1)
    .max(500),
})

/** 후보 일괄 확정 — 한 건 충돌이 나머지를 막지 않는다(건별 결과 반환). */
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  let confirmed = 0
  const skipped: Array<{ coupangProductItemId: string; reason: string }> = []
  for (const p of parsed.data.pairs) {
    const r = await linkCoupangItem(resolved.space.id, p.coupangProductItemId, p.listingId)
    if (r.ok) confirmed += 1
    else skipped.push({ coupangProductItemId: p.coupangProductItemId, reason: r.reason })
  }
  return NextResponse.json({ confirmed, skipped })
}
```

`app/api/sh/coupang-price/sync/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { requireCoupangWorkspaceId } from '@/lib/coupang/workspace-space'

/**
 * POST /api/sh/coupang-price/sync — 쿠팡 상품 수동 불러오기(PRODUCT_SYNC 잡).
 * cron 의 20시간 중복 판정은 cron 경로에만 둔다 — 수동은 진행 중 잡만 막는다
 * (v1 후속과제 "수동 재실행이 조용히 스킵됨" 해소).
 */
export async function POST() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  let workspaceId: string
  try {
    workspaceId = await requireCoupangWorkspaceId(spaceId)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : '쿠팡 연동이 없습니다', 400)
  }
  const running = await prisma.coupangWriteJob.findFirst({
    where: { workspaceId, kind: 'PRODUCT_SYNC', status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  })
  if (running) return errorResponse('쿠팡 상품을 이미 불러오는 중입니다', 409)

  const job = await prisma.coupangWriteJob.create({
    data: { workspaceId, spaceId, kind: 'PRODUCT_SYNC', payload: {} },
    select: { id: true },
  })
  return NextResponse.json({ job: { id: job.id } }, { status: 201 })
}
```

- [ ] **Step 8: 테스트·타입**

Run: `npx jest src/lib/sh/coupang-price app/api/sh/coupang-price && npx tsc --noEmit -p . 2>&1 | grep "error TS"`
Expected: PASS, 베이스라인 1건.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/sh/coupang-price app/api/sh/coupang-price
git commit -m "✨ feat(coupang-ads): 쿠팡 옵션 자동 매칭 후보(재고 매핑 경유) + 일괄 확정·해제·수동 불러오기 API"
```

---

### Task 8: 쿠팡 매칭 화면

**Files:**
- Create: `src/components/sh/products/listings/coupang-matching-view.tsx`
- Create: `app/d/seller-ops/products/listings/coupang-matching/page.tsx`
- Modify: `app/d/seller-ops/products/listings/page.tsx` (진입 버튼)

**Interfaces:**
- Consumes: Task 7 API 들, `MatchingRow`/`MatchStatus` 타입(`@/lib/sh/coupang-price/load-matching`, `match-candidates` — **타입만** import, 함수 import 금지: prisma 가 클라이언트 번들로 들어간다. `import type` 사용), Task 6 `SELLER_HUB_COUPANG_MATCHING_PATH`, 기존 `CoupangItemPickerDialog` 는 리스팅→쿠팡 방향이라 여기서는 쓰지 않고, 모호 후보는 후보 중 선택으로 처리.
- Produces: UI.

- [ ] **Step 1: 페이지**

`app/d/seller-ops/products/listings/coupang-matching/page.tsx`:

```tsx
import { CoupangMatchingView } from '@/components/sh/products/listings/coupang-matching-view'

export default function CoupangMatchingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">쿠팡 상품 매칭</h1>
        <p className="text-sm text-muted-foreground">
          쿠팡 옵션과 판매채널 상품을 연결합니다. 연결된 상품만 가격시뮬에서 쿠팡 판매가로 반영할 수 있습니다
        </p>
      </div>
      <CoupangMatchingView />
    </div>
  )
}
```

- [ ] **Step 2: 뷰 컴포넌트**

`src/components/sh/products/listings/coupang-matching-view.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { wingListingUrl } from '@/lib/coupang/wing-link'
import type { MatchingRow } from '@/lib/sh/coupang-price/load-matching'
import type { MatchStatus } from '@/lib/sh/coupang-price/match-candidates'

const STATUS_LABEL: Record<MatchStatus, string> = {
  NEEDS_REVIEW: '확인 필요',
  CANDIDATE: '후보',
  AMBIGUOUS: '모호',
  NONE: '수동',
  CONFIRMED: '확정',
}
const STATUS_CLASS: Record<MatchStatus, string> = {
  NEEDS_REVIEW: 'border-amber-400 text-amber-700',
  CANDIDATE: 'border-blue-300 text-blue-700',
  AMBIGUOUS: 'border-amber-300 text-amber-700',
  NONE: 'text-muted-foreground',
  CONFIRMED: 'border-emerald-300 text-emerald-700',
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? `요청 실패 (HTTP ${res.status})`)
  return data
}

export function CoupangMatchingView() {
  const [rows, setRows] = useState<MatchingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = (await send('/api/sh/coupang-price/matching', 'GET')) as { rows: MatchingRow[] }
      setRows(data.rows)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매칭 목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<MatchStatus, number> = { NEEDS_REVIEW: 0, CANDIDATE: 0, AMBIGUOUS: 0, NONE: 0, CONFIRMED: 0 }
    for (const r of rows) c[r.status] += 1
    return c
  }, [rows])

  async function confirm(pairs: Array<{ coupangProductItemId: string; listingId: string }>) {
    setBusy(true)
    try {
      const r = (await send('/api/sh/coupang-price/matching/confirm', 'POST', { pairs })) as {
        confirmed: number
        skipped: Array<{ reason: string }>
      }
      toast.success(`${r.confirmed}건 확정${r.skipped.length ? ` · ${r.skipped.length}건 건너뜀` : ''}`)
      if (r.skipped.length) toast.warning(r.skipped[0].reason)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '확정 실패')
    } finally {
      setBusy(false)
    }
  }

  async function unlink(id: string) {
    setBusy(true)
    try {
      await send('/api/sh/coupang-price/link', 'DELETE', { coupangProductItemId: id })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '해제 실패')
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setBusy(true)
    try {
      await send('/api/sh/coupang-price/sync', 'POST')
      toast.success('쿠팡 상품을 불러오는 중입니다. 1~2분 뒤 새로고침하세요')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '불러오기 실패')
    } finally {
      setBusy(false)
    }
  }

  const candidatePairs = rows
    .filter((r) => r.status === 'CANDIDATE')
    .map((r) => ({ coupangProductItemId: r.id, listingId: r.candidates[0].id }))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(Object.keys(STATUS_LABEL) as MatchStatus[]).map((s) => (
          <Badge key={s} variant="outline" className={STATUS_CLASS[s]}>
            {STATUS_LABEL[s]} {counts[s]}
          </Badge>
        ))}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={syncNow}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            지금 쿠팡 상품 불러오기
          </Button>
          <Button size="sm" disabled={busy || candidatePairs.length === 0} onClick={() => confirm(candidatePairs)}>
            후보 {candidatePairs.length}건 일괄 확정
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>쿠팡 옵션</TableHead>
              <TableHead className="text-right">쿠팡 현재가 (RG / 판매자배송)</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>판매채널 상품</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  수집된 쿠팡 상품이 없습니다. “지금 쿠팡 상품 불러오기”를 눌러주세요
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[320px] whitespace-normal">
                    <span className="flex items-center gap-1 font-medium">
                      {r.itemName ?? r.sellerProductId}
                      <a
                        href={wingListingUrl(r.sellerProductId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="쿠팡 Wing에서 보기"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      RG {r.rgVendorItemId ?? '—'} · 판매자배송 {r.mpVendorItemId ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {r.rgSalePrice?.toLocaleString('ko-KR') ?? '—'} / {r.mpSalePrice?.toLocaleString('ko-KR') ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_CLASS[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[280px] whitespace-normal text-sm">
                    {r.listing ? (
                      <>
                        {r.listing.name}
                        {r.status === 'NEEDS_REVIEW' && r.candidates[0] && (
                          <p className="text-xs text-amber-700">재고 매핑 기준 후보: {r.candidates[0].name}</p>
                        )}
                      </>
                    ) : r.candidates.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {r.candidates.map((c) => (
                          <Button
                            key={c.id}
                            size="sm"
                            variant="ghost"
                            className="h-auto justify-start whitespace-normal px-1 py-0.5 text-left text-xs"
                            disabled={busy}
                            onClick={() => confirm([{ coupangProductItemId: r.id, listingId: c.id }])}
                          >
                            {c.name} — 이걸로 확정
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        가격시뮬 반영 화면의 “쿠팡 옵션 연결”로 직접 연결하세요
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.listing && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => unlink(r.id)}>
                        연결 해제
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 판매채널 상품 페이지에 진입 버튼**

`app/d/seller-ops/products/listings/page.tsx` 의 제목 블록을:

```tsx
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { ListingsTwoPane } from '@/components/sh/products/listings/listings-two-pane'
import { SELLER_HUB_COUPANG_MATCHING_PATH } from '@/lib/deck-routes'

export default function ListingsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">판매채널 상품</h1>
          <p className="text-sm text-muted-foreground">채널별로 판매할 상품 묶음을 구성합니다</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={SELLER_HUB_COUPANG_MATCHING_PATH}>쿠팡 상품 매칭</Link>
        </Button>
      </div>
      <ListingsTwoPane />
    </div>
  )
}
```

- [ ] **Step 4: 타입·린트**

Run: `npx tsc --noEmit -p . 2>&1 | grep "error TS"; npx eslint src/components/sh/products/listings/coupang-matching-view.tsx "app/d/seller-ops/products/listings"`
Expected: 베이스라인 1건, eslint 에러 0. 그리고 클라이언트 번들 오염 확인: `grep -n "^import" src/components/sh/products/listings/coupang-matching-view.tsx` 에서 `load-matching`/`match-candidates` 가 `import type` 인지.

- [ ] **Step 5: 커밋**

```bash
git add src/components/sh/products/listings/coupang-matching-view.tsx "app/d/seller-ops/products/listings"
git commit -m "✨ feat(coupang-ads): 쿠팡 상품 매칭 화면 (후보 일괄 확정·해제·수동 불러오기)"
```

---

### Task 9: 전체 검증 + 문서 정리

**Files:**
- Modify: `docs/decks/coupang-ads/guides/PRICE_WRITE_FOLLOWUPS.md`
- Modify: `docs/decks/coupang-ads/prd/PRD_PRICE_WRITE_V1.md` (헤더에 v1.1 포인터 1줄)

- [ ] **Step 1: 전체 정적 검증 (필터 없이)**

```bash
npx tsc --noEmit -p . 2>&1 | grep "error TS"          # 기대: next.config.ts agentRules 1건만
(cd worker && npx tsc --noEmit 2>&1 | grep -c "error TS")   # 기대: 4 (analysis-poller 베이스라인)
npm run lint 2>&1 | tail -3                           # 기대: error 0
```

- [ ] **Step 2: 테스트**

```bash
npx jest src/lib/sh/coupang-price app/api/sh/coupang-price app/api/coupang
(cd worker && npx tsx --test src/__tests__/coupang-write-poller.test.ts src/coupang-api/__tests__/*.test.ts src/write-jobs/__tests__/price-change.test.ts)
```

Expected: 전부 PASS.

- [ ] **Step 3: 빌드**

Run: `npm run build 2>&1 | tail -15`
Expected: 성공. (Vercel 빌드와 같은 타입체크 — 테스트 파일 타입 오류도 여기서 잡힌다.)

- [ ] **Step 4: 문서**

`PRD_PRICE_WRITE_V1.md` 3번째 줄(작성/개정 줄) 아래에:

```markdown
> **2026-10-05 v1.1 개정** — 승인 큐 제거·세트 반영·일괄 매칭·판매가 동기화. 차분은 [`PRD_PRICE_WRITE_V1_1.md`](./PRD_PRICE_WRITE_V1_1.md) 가 이 문서보다 우선한다.
```

`PRICE_WRITE_FOLLOWUPS.md` 의 "지금 곧" 표에서 해소된 3행(cron 20h 창 → sync 라우트, half-up 테스트, report status 검증)을 지우고, "미구현" 표의 §16.4 IP 거부 알림·§12 Slack 역할 게이트·`idempotencyKey`·액션 생성 역할 게이트 4행을 다음 1행으로 교체:

```markdown
| 승인 큐 경로 전반 | **v1.1 에서 승인 큐 자체를 제거했다**(1인 운영). 역할 게이트는 반영 API 의 `assertRole(ADMIN)` 이 대신한다. 에이전트 제안 흐름이 필요해지면 그때 승인 경로를 다시 붙인다 |
```

- [ ] **Step 5: 커밋**

```bash
git add docs/decks/coupang-ads
git commit -m "📝 docs(coupang-ads): 가격 쓰기 v1.1 개정 반영 — 후속과제 정리"
```

- [ ] **Step 6: dev 화면 확인 (브라우저)**

`npm run dev` 후(포트가 3000 이 아니면 메모리 `reference_dev_worktree_playwright_verify` 참고) 로컬 QA 계정(메모리 `reference_local_dev_qa_login`)으로:
1. `/d/seller-ops/products/listings` → "쿠팡 상품 매칭" 버튼 → 매칭 화면 빈 상태 문구 표시.
2. 가격시뮬 기존 상품 모드에서 쿠팡 채널 카드 → 반영 다이얼로그: 체크박스 없음, 자동조정 안내·최저가 컬럼 표시, 버튼 문구 "쿠팡에 반영 (N개)".
3. 신규 상품 모드에서 쿠팡 버튼 비활성 + 툴팁.

dev DB 에는 `CoupangProductItem` 이 0건이라 실제 반영·자동 후보는 운영 데이터 + 워커가 있어야 확인된다 → 배포 후 v1.1 §8 시험 절차(사용자 지정 옵션 1개, 10원)에서 검증한다. **이 시험은 사용자가 대상 옵션을 지정해야 시작한다.**
