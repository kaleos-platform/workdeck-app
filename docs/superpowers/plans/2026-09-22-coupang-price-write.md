# 쿠팡 가격 쓰기 (v1) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가격시뮬레이션의 채널별 판매가를 승인 큐를 거쳐 쿠팡 실판매가(+자동 가격조정 하한)에 반영한다.

**Architecture:** 앱(Vercel)은 쿠팡 API를 호출할 수 없다(IP allowlist). 승인된 액션의 `execute()` 는 `CoupangWriteJob` PENDING 행만 만들고, 워커가 30초 폴링으로 집어 실제 PUT 을 수행한다. 리스팅↔쿠팡옵션 매핑은 전수 매칭 대신 사용 시점 지연 매핑으로 채운다.

**Tech Stack:** Next.js 16 App Router · Prisma 7 · TypeScript · Jest(앱) · `node:test`+tsx(워커) · Slack Block Kit

**Spec:** `docs/decks/coupang-ads/prd/PRD_PRICE_WRITE_V1.md`

## Global Constraints

- **응답 성공 판정은 HTTP 상태가 아니라 중첩 body 필드** `data.code === 'SUCCESS'`. HTTP 200 이어도 실패일 수 있다.
- **쿠팡 가격은 최소 10원 단위.** `price` 는 10원 반올림, `apMinSalePrice` 는 10원 **올림**.
- **`apMinSalePrice` 와 `apActive` 는 반드시 함께 전송**한다. 단독 전송은 400.
- **`apMinSalePrice < price`** 여야 한다.
- **`forceSalePriceUpdate` 는 사용하지 않는다.**
- **쿠팡 API 호출은 워커에서만.** 앱 코드에서 `api-gateway.coupang.com` 을 호출하지 않는다.
- 외부 응답을 `as` 로 캐스팅하기 전에 **실물 샘플 픽스처 테스트를 먼저 고정**한다. 이 기능의 기존 실패 5건이 전부 "타입이 실물과 달라 조용히 `undefined`" 유형이었다.
- **RG `vendorItemId` 는 `items[].rocketGrowthItemData.vendorItemId`, 가격은 `…ItemData.priceData.salePrice` — 모두 중첩.** 평면으로 읽으면 에러 없이 0건/null 이 된다.
- DB 스키마 변경은 `npx prisma migrate dev --name <작업명>` 만 사용. `prisma db push` 금지.
- 커밋 메시지는 이모지 + Conventional Commit (`✨ feat(coupang-ads): …`).
- 사용자 대상 문구는 한국어.

### 테스트 실행 명령

| 대상               | 명령                                                             |
| ------------------ | ---------------------------------------------------------------- |
| 워커 (`node:test`) | `npx tsx --test worker/src/coupang-api/__tests__/<file>.test.ts` |
| 앱 단위 (Jest)     | `npx jest <path> -t "<test name>"`                               |
| 앱 e2e (실 DB)     | `npx jest -c jest.config.e2e.ts <path>`                          |

⚠️ 워커 테스트는 `node:test` 기반이라 **Jest 로 실행하면 실패**한다(기존 3 suite 도 동일). 반드시 `tsx --test` 로 돌린다.

## File Structure

**워커 — 쿠팡 API 계층** (`worker/src/coupang-api/`)

| 파일                                     | 책임                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `client.ts` (수정)                       | `put<T>()` 추가. 서명·스로틀·429 백오프·IP거부 분류 재사용              |
| `write-result.ts` (신규)                 | 쓰기 응답 중첩 body 해석 1곳. `unwrapWriteResult()`                     |
| `endpoints.ts` (수정)                    | `fetchVendorItemStatus`, `changeVendorItemPrice`, `extractProductItems` |
| `__tests__/write-result.test.ts` (신규)  | 성공/ERROR/400 픽스처                                                   |
| `__tests__/product-items.test.ts` (신규) | RG·MP 중첩 + `priceData` 파싱 픽스처                                    |

**워커 — 실행기** (`worker/src/`)

| 파일                                | 책임                                                    |
| ----------------------------------- | ------------------------------------------------------- |
| `coupang-write-poller.ts` (신규)    | PENDING 잡 claim → kind 분기 → 결과 보고                |
| `write-jobs/price-change.ts` (신규) | 타깃 순차 PUT, 부분 실패 누적                           |
| `write-jobs/product-sync.ts` (신규) | 상품 목록→단건 순회 후 앱에 적재 요청                   |
| `api-client.ts` (수정)              | `claimWriteJob`, `reportWriteJob`, `upsertProductItems` |
| `index.ts` (수정)                   | `startCoupangWritePoller()` 등록                        |

**앱 — 도메인** (`src/lib/`)

| 파일                                        | 책임                                   |
| ------------------------------------------- | -------------------------------------- |
| `agent/actions/execute.ts` (수정)           | 승인 게이트에 `expiresAt` 검사         |
| `sh/coupang-price/listing-derive.ts` (신규) | 가격그룹 → 리스팅 유도 (시그니처 매칭) |
| `sh/coupang-price/price-round.ts` (신규)    | 10원 반올림/올림, 가드 술어            |
| `sh/coupang-price/build-targets.ts` (신규)  | 미리보기·액션 공용 타깃 조립           |
| `agent/actions/coupang-price.ts` (신규)     | `ActionDefinition` — 잡 생성까지만     |
| `slack/notify-write-job-result.ts` (신규)   | 승인 메시지 스레드 답글                |

**앱 — 라우트** (`app/api/`)

| 파일                                                | 책임                                 |
| --------------------------------------------------- | ------------------------------------ |
| `coupang/write-jobs/claim/route.ts` (신규)          | 워커 claim (POST)                    |
| `coupang/write-jobs/[jobId]/report/route.ts` (신규) | 워커 결과 보고 (POST)                |
| `coupang/product-items/route.ts` (신규)             | 워커 적재(POST) · 미리보기 조회(GET) |
| `sh/coupang-price/preview/route.ts` (신규)          | 미리보기 데이터                      |
| `sh/coupang-price/link/route.ts` (신규)             | 지연 매핑 확정                       |
| `cron/coupang-product-sync/route.ts` (신규)         | 일일 잡 생성                         |
| `cron/coupang-write-jobs-reap/route.ts` (신규)      | stale RUNNING 회수                   |

**앱 — UI** (`src/components/sh/products/pricing-sim/`)

| 파일                                    | 책임                            |
| --------------------------------------- | ------------------------------- |
| `coupang-price-apply-dialog.tsx` (신규) | 미리보기 + 자동조정 블록 + 제출 |
| `coupang-item-picker-dialog.tsx` (신규) | 지연 매핑 피커                  |
| `pricing-channel-board-card.tsx` (수정) | 버튼 + Wing 링크                |

---

## Task 1: 승인 만료 게이트

**Files:**

- Modify: `src/lib/agent/actions/execute.ts:24-42`
- Test: `src/lib/agent/actions/__tests__/approve-expiry.e2e.test.ts`

**Interfaces:**

- Consumes: 없음 (독립 · 가장 먼저 수행)
- Produces: `approveAndExecute` 가 만료 액션에 `{ ok: false, status: 'EXPIRED' }` 를 반환한다. Task 7 의 6시간 만료가 이것에 의존한다.

현재 게이트는 `status: 'PENDING'` 만 본다. `EXPIRED` 전환은 목록 lazy expire 와 하루 1회 cron 뿐이라, 만료된 액션도 전환 전이면 승인·실행된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/agent/actions/__tests__/` 의 기존 e2e 테스트(`state-machine.e2e.test.ts`)의 시드 패턴을 먼저 읽고 같은 방식으로 Space/User 를 준비한다.

```ts
// @jest-environment node
import { prisma } from '@/lib/prisma'
import { approveAndExecute } from '../execute'

// 시드 헬퍼는 state-machine.e2e.test.ts 와 동일한 방식으로 작성한다.

test('만료된 PENDING 액션은 승인되지 않는다', async () => {
  const action = await prisma.agentPendingAction.create({
    data: {
      spaceId,
      deckKey: 'finance',
      actionType: 'finance.transaction.reclassify',
      payload: { transactionId: 'x', categoryId: 'y' },
      summary: '테스트',
      source: 'WEB',
      requestedBy: userId,
      expiresAt: new Date(Date.now() - 60_000), // 1분 전 만료
    },
  })

  const res = await approveAndExecute(action.id, userId)

  expect(res.ok).toBe(false)
  expect(res.status).toBe('EXPIRED')

  const after = await prisma.agentPendingAction.findUnique({ where: { id: action.id } })
  expect(after?.status).toBe('PENDING') // APPROVED 로 넘어가지 않았다
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest -c jest.config.e2e.ts src/lib/agent/actions/__tests__/approve-expiry.e2e.test.ts`
Expected: FAIL — `res.status` 가 `'EXECUTED'` 또는 `'FAILED'`(액션이 실제로 실행됨)

- [ ] **Step 3: 게이트를 고친다**

`src/lib/agent/actions/execute.ts` 의 `approveAndExecute` 시작부를 다음으로 교체한다.

```ts
export async function approveAndExecute(
  actionId: string,
  deciderId: string
): Promise<DecisionOutcome> {
  const now = new Date()

  // 게이트: PENDING 이고 아직 만료되지 않은 경우에만 APPROVED 로 전이.
  // expiresAt 을 보지 않으면 EXPIRED 전환(목록 lazy expire·하루 1회 cron) 전의
  // 만료 액션이 그대로 승인·실행된다 — 가격 쓰기의 6시간 만료가 무효가 된다.
  const gate = await prisma.agentPendingAction.updateMany({
    where: { id: actionId, status: 'PENDING', expiresAt: { gt: now } },
    data: { status: 'APPROVED', decidedBy: deciderId, decidedAt: now },
  })
  if (gate.count !== 1) {
    // count=0 의 사유를 나눠야 사용자가 영문을 안다.
    const current = await prisma.agentPendingAction.findUnique({
      where: { id: actionId },
      select: { status: true, expiresAt: true },
    })
    if (current?.status === 'PENDING' && current.expiresAt <= now) {
      return {
        ok: false,
        status: 'EXPIRED',
        message: '승인 유효기간이 지난 액션입니다. 다시 요청해 주세요',
      }
    }
    return {
      ok: false,
      status: 'CONFLICT',
      message: '이미 처리되었거나 대기 상태가 아닌 액션입니다',
    }
  }
```

`DecisionOutcome` 의 `status` 유니온에 `'EXPIRED'` 를 추가한다(같은 파일 또는 `types.ts` — 정의 위치를 grep 으로 확인 후 수정).

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest -c jest.config.e2e.ts src/lib/agent/actions/__tests__/approve-expiry.e2e.test.ts`
Expected: PASS

- [ ] **Step 5: 호출부 대응을 확인한다**

Run: `npx tsc --noEmit`
Expected: 통과. `'EXPIRED'` 를 다루지 않는 switch/분기가 있으면 "승인 유효기간이 지났습니다" 토스트를 띄우도록 보완한다(`src/components/approvals/approval-detail-sheet.tsx` 의 `outcomeNote` 분기).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/agent/actions/execute.ts src/lib/agent/actions/__tests__/approve-expiry.e2e.test.ts src/components/approvals/approval-detail-sheet.tsx
git commit -m "🔒 fix(agent): 승인 게이트가 만료 액션을 거르지 않던 문제

status 만 검사해 EXPIRED 전환 전의 만료 액션이 승인·실행됐다.
expiresAt 검사를 추가하고 count=0 사유를 CONFLICT/EXPIRED 로 분리한다."
```

---

## Task 2: 쓰기 응답 해석 (`unwrapWriteResult`)

**Files:**

- Create: `worker/src/coupang-api/write-result.ts`
- Test: `worker/src/coupang-api/__tests__/write-result.test.ts`

**Interfaces:**

- Consumes: 없음
- Produces:

  ```ts
  export class CoupangWriteError extends Error {
    readonly coupangMessage: string
    readonly httpStatus?: number
  }
  export function unwrapWriteResult(body: unknown, httpStatus: number): number
  ```

  Task 3 의 `changeVendorItemPrice` 가 사용한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// worker/src/coupang-api/__tests__/write-result.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unwrapWriteResult, CoupangWriteError } from '../write-result.js'

// 실물 성공 응답 — 성공 판정은 HTTP 200 이 아니라 중첩된 data.code 다.
const SUCCESS = {
  code: '200',
  message: '',
  data: { code: 'SUCCESS', message: '', data: 427011919 },
}

test('성공 — 중첩 data.code 가 SUCCESS 면 내부 data 를 돌려준다', () => {
  assert.equal(unwrapWriteResult(SUCCESS, 200), 427011919)
})

test('HTTP 200 이어도 중첩 code 가 ERROR 면 실패로 던진다', () => {
  const body = {
    code: '200',
    message: '',
    data: { code: 'ERROR', message: '삭제된 상품은 변경이 불가능합니다', data: null },
  }
  assert.throws(
    () => unwrapWriteResult(body, 200),
    (err: unknown) =>
      err instanceof CoupangWriteError && err.coupangMessage === '삭제된 상품은 변경이 불가능합니다'
  )
})

test('HTTP 400 — 최상위 message 를 사람이 읽을 사유로 쓴다', () => {
  const body = {
    code: '400',
    message: '변경전 판매가의 최대 50% 인하/최대 100%인상까지 변경가능합니다.',
  }
  assert.throws(
    () => unwrapWriteResult(body, 400),
    (err: unknown) =>
      err instanceof CoupangWriteError &&
      err.coupangMessage.includes('최대 50% 인하') &&
      err.httpStatus === 400
  )
})

test('예상 밖 형태 — 조용히 성공 처리하지 않는다', () => {
  assert.throws(() => unwrapWriteResult({ ok: true }, 200), CoupangWriteError)
  assert.throws(() => unwrapWriteResult(null, 200), CoupangWriteError)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test worker/src/coupang-api/__tests__/write-result.test.ts`
Expected: FAIL — `Cannot find module '../write-result.js'`

- [ ] **Step 3: 구현한다**

```ts
// worker/src/coupang-api/write-result.ts
/**
 * 쿠팡 쓰기 API 응답 해석 — 단일 지점.
 *
 * 성공 판정은 HTTP 상태가 아니라 **중첩된 data.code** 다:
 *   { "code":"200", "message":"", "data": { "code":"SUCCESS", "message":"", "data": 427011919 } }
 *
 * HTTP 200 을 성공으로 읽으면 "가격이 반영됐다"고 보고하고 실제로는 안 바뀐다.
 * 이 프로젝트의 무음 실패 5건이 전부 같은 유형(타입이 실물과 달라 조용히 undefined)이었다.
 */
export class CoupangWriteError extends Error {
  readonly coupangMessage: string
  readonly httpStatus?: number

  constructor(coupangMessage: string, httpStatus?: number) {
    super(`쿠팡 쓰기 실패: ${coupangMessage}`)
    this.name = 'CoupangWriteError'
    this.coupangMessage = coupangMessage
    this.httpStatus = httpStatus
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** 성공이면 쿠팡이 돌려준 내부 data(보통 vendorItemId)를 반환, 아니면 CoupangWriteError. */
export function unwrapWriteResult(body: unknown, httpStatus: number): number {
  if (!body || typeof body !== 'object') {
    throw new CoupangWriteError(`응답 본문을 해석할 수 없습니다 (HTTP ${httpStatus})`, httpStatus)
  }
  const outer = body as Record<string, unknown>

  const inner = outer.data
  if (inner && typeof inner === 'object') {
    const d = inner as Record<string, unknown>
    if (d.code === 'SUCCESS') {
      const value = d.data
      // data 가 숫자가 아닌 응답도 있을 수 있으나, 성공 판정 자체는 code 가 결정한다.
      return typeof value === 'number' ? value : 0
    }
    if (d.code === 'ERROR') {
      throw new CoupangWriteError(
        str(d.message) ?? str(outer.message) ?? '쿠팡이 요청을 거부했습니다',
        httpStatus
      )
    }
  }

  // 400 계열은 중첩 data 없이 최상위 message 만 온다.
  const top = str(outer.message)
  if (top) throw new CoupangWriteError(top, httpStatus)

  throw new CoupangWriteError(`알 수 없는 응답 형태 (HTTP ${httpStatus})`, httpStatus)
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test worker/src/coupang-api/__tests__/write-result.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add worker/src/coupang-api/write-result.ts worker/src/coupang-api/__tests__/write-result.test.ts
git commit -m "✨ feat(coupang-ads): 쿠팡 쓰기 응답 해석 + 픽스처 테스트

성공 판정은 HTTP 상태가 아니라 중첩 data.code === 'SUCCESS'.
200 을 성공으로 읽으면 반영 안 된 가격을 반영됐다고 보고한다."
```

---

## Task 3: 클라이언트 PUT + 쿠팡 엔드포인트 래퍼

**Files:**

- Modify: `worker/src/coupang-api/client.ts`
- Modify: `worker/src/coupang-api/endpoints.ts`
- Test: `worker/src/coupang-api/__tests__/price-endpoints.test.ts`

**Interfaces:**

- Consumes: Task 2 의 `unwrapWriteResult`, `CoupangWriteError`
- Produces:

  ```ts
  // client.ts
  put<T>(path: string, query?: Record<string, string | number | undefined>): Promise<{ body: T; status: number }>

  // endpoints.ts
  export interface VendorItemStatus {
    sellerItemId: number
    amountInStock: number
    salePrice: number
    onSale: boolean
  }
  export async function fetchVendorItemStatus(
    client: CoupangApiClient, vendorItemId: string | number
  ): Promise<VendorItemStatus>

  export async function changeVendorItemPrice(
    client: CoupangApiClient,
    args: { vendorItemId: string | number; price: number; apActive: boolean; apMinSalePrice: number }
  ): Promise<number>
  ```

  Task 8 의 `price-change.ts` 가 사용한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`fetch` 를 가짜로 바꿔 요청 URL·메서드를 검증한다. **서명 message 에 쿼리가 들어가므로** 쿼리 조립이 URL 과 일치하는지도 본다.

```ts
// worker/src/coupang-api/__tests__/price-endpoints.test.ts
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { CoupangApiClient } from '../client.js'
import { changeVendorItemPrice, fetchVendorItemStatus } from '../endpoints.js'
import { CoupangWriteError } from '../write-result.js'

const realFetch = globalThis.fetch
let calls: Array<{ url: string; method: string }> = []

function stubFetch(status: number, body: unknown) {
  calls = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  }) as typeof fetch
}

function makeClient() {
  return new CoupangApiClient({ vendorId: 'A00000000', accessKey: 'ak', secretKey: 'sk' })
}

afterEach(() => {
  globalThis.fetch = realFetch
})

test('changeVendorItemPrice — PUT + apActive·apMinSalePrice 쿼리', async () => {
  stubFetch(200, { code: '200', message: '', data: { code: 'SUCCESS', message: '', data: 99 } })
  const result = await changeVendorItemPrice(makeClient(), {
    vendorItemId: 96037831212,
    price: 65790,
    apActive: true,
    apMinSalePrice: 58200,
  })
  assert.equal(result, 99)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'PUT')
  assert.match(
    calls[0].url,
    /\/marketplace\/vendor-items\/96037831212\/prices\/65790\?apActive=true&apMinSalePrice=58200$/
  )
})

test('changeVendorItemPrice — HTTP 400 이면 쿠팡 문구를 담아 던진다', async () => {
  stubFetch(400, {
    code: '400',
    message: '최소 10원 단위로 입력가능합니다',
  })
  await assert.rejects(
    () =>
      changeVendorItemPrice(makeClient(), {
        vendorItemId: 1,
        price: 1001,
        apActive: true,
        apMinSalePrice: 900,
      }),
    (err: unknown) =>
      err instanceof CoupangWriteError && err.coupangMessage === '최소 10원 단위로 입력가능합니다'
  )
})

test('fetchVendorItemStatus — 4필드를 그대로 돌려준다', async () => {
  stubFetch(200, {
    code: 200,
    message: '',
    data: { sellerItemId: 96037831212, amountInStock: 12, salePrice: 65790, onSale: true },
  })
  const s = await fetchVendorItemStatus(makeClient(), 96037831212)
  assert.equal(s.salePrice, 65790)
  assert.equal(s.onSale, true)
  assert.equal(calls[0].method, 'GET')
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test worker/src/coupang-api/__tests__/price-endpoints.test.ts`
Expected: FAIL — `changeVendorItemPrice is not a function`

- [ ] **Step 3: `client.put()` 을 추가한다**

`worker/src/coupang-api/client.ts` 의 `get()` 바로 아래에 넣는다. `get()` 의 재시도·스로틀 구조를 그대로 따르되, **쿼리 문자열을 한 번만 만들어 서명과 URL 양쪽에 쓴다**(순서가 어긋나면 서명 불일치).

```ts
  /**
   * PUT 호출. CEA 서명 message 는 signedDate+method+path+query 로 body 를 포함하지 않으므로
   * 서명 로직은 get() 과 동일하다. 단 쿼리 파라미터(apActive 등)는 서명 message 에 들어가므로
   * 문자열을 한 번만 만들어 서명과 URL 양쪽에 같은 것을 써야 한다.
   *
   * 응답은 해석하지 않고 그대로 돌려준다 — 성공 판정은 중첩 body 필드라
   * write-result.ts 가 단독으로 책임진다(호출부가 status 로 판단하지 못하게).
   */
  async put<T>(
    path: string,
    query?: Record<string, string | number | undefined>
  ): Promise<{ body: T; status: number }> {
    const queryStr = buildQueryString(query)
    const url = `${COUPANG_API_BASE}${path}${queryStr ? `?${queryStr}` : ''}`

    let attempt = 0
    for (;;) {
      await this.throttle()

      const authorization = buildAuthorization({
        method: 'PUT',
        path,
        query: queryStr,
        accessKey: this.cfg.accessKey,
        secretKey: this.cfg.secretKey,
      })

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Authorization: authorization,
          'X-Requested-By': this.cfg.vendorId,
        },
      })

      const text = await response.text().catch(() => '')
      let body: unknown = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = null
      }

      if (response.status === 429 && attempt < MAX_RETRIES) {
        attempt += 1
        const backoffMs = MIN_INTERVAL_MS * 2 ** attempt
        console.warn(
          `[coupang-api] 429 재시도 ${attempt}/${MAX_RETRIES} — ${backoffMs}ms 대기 (PUT ${path})`
        )
        await sleep(backoffMs)
        continue
      }

      // IP allowlist 미등록은 다른 실패와 구분해야 알림 문구가 정확해진다.
      const reason = classifyApiFailure(response.status, text)
      if (reason === 'IP_REJECTED') {
        throw new CoupangApiError(reason, `쿠팡 API IP 거부 (PUT ${path})`, response.status, text)
      }

      return { body: body as T, status: response.status }
    }
  }
```

- [ ] **Step 4: 엔드포인트 래퍼를 추가한다**

`worker/src/coupang-api/endpoints.ts` 하단에 추가한다.

```ts
import { unwrapWriteResult } from './write-result.js'

// ─── 아이템별 수량/가격/상태 조회 ────────────────────────────────────────────
// 응답은 4필드뿐이다(실측): sellerItemId · amountInStock · salePrice · onSale.
// 자동 가격조정(apActive/apMinSalePrice) 상태는 응답에 없다 — 읽을 수단이 없다.
export interface VendorItemStatus {
  sellerItemId: number
  amountInStock: number
  salePrice: number
  onSale: boolean
}

interface VendorItemStatusResponse {
  code: number | string
  message: string
  data: VendorItemStatus
}

export async function fetchVendorItemStatus(
  client: CoupangApiClient,
  vendorItemId: string | number
): Promise<VendorItemStatus> {
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/inventories`
  const res = await client.get<VendorItemStatusResponse>(path)
  return res.data
}

// ─── 아이템별 가격 변경 ──────────────────────────────────────────────────────
// 로켓그로스/하이브리드 상품도 이 API 가 정규 경로다(상품수정 API 로는 불가).
// apActive·apMinSalePrice 는 반드시 함께 보낸다 — 단독이면 400.
// forceSalePriceUpdate 는 쓰지 않는다(쿠팡 자체 변동폭 가드를 살려둔다).
export async function changeVendorItemPrice(
  client: CoupangApiClient,
  args: {
    vendorItemId: string | number
    price: number
    apActive: boolean
    apMinSalePrice: number
  }
): Promise<number> {
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${args.vendorItemId}/prices/${args.price}`
  const { body, status } = await client.put<unknown>(path, {
    apActive: String(args.apActive),
    apMinSalePrice: args.apMinSalePrice,
  })
  return unwrapWriteResult(body, status)
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx tsx --test worker/src/coupang-api/__tests__/price-endpoints.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: 기존 회귀 23건이 여전히 통과하는지 확인한다**

Run: `npx tsx --test worker/src/coupang-api/__tests__/*.test.ts`
Expected: PASS — 기존 23 + 신규 7

- [ ] **Step 7: 커밋**

```bash
git add worker/src/coupang-api/client.ts worker/src/coupang-api/endpoints.ts worker/src/coupang-api/__tests__/price-endpoints.test.ts
git commit -m "✨ feat(coupang-ads): 쿠팡 PUT 클라이언트 + 가격변경·상태조회 래퍼

쿼리 문자열을 한 번만 만들어 서명과 URL 양쪽에 쓴다 —
apActive/apMinSalePrice 는 쿼리라 CEA 서명 message 에 포함된다."
```

> **⚠️ Step 4 의 조회 엔드포인트 경로는 반드시 실호출로 확인한다.** 문서에 경로가 명시돼 있지 않아 추정이다. Task 5 의 실호출 스크립트에서 404 가 나면 공식 문서(상품 아이템별 수량/가격/상태 조회)의 경로로 교체하고 테스트도 함께 고친다.

---

## Task 4: 상품 item 파싱 (`extractProductItems`)

**Files:**

- Modify: `worker/src/coupang-api/endpoints.ts`
- Test: `worker/src/coupang-api/__tests__/product-items.test.ts`

**Interfaces:**

- Consumes: `SellerProductDetail` (기존)
- Produces:
  ```ts
  export interface CoupangProductItemRow {
    sellerProductId: string
    itemName: string | null
    rgVendorItemId: string | null
    rgSalePrice: number | null
    mpVendorItemId: string | null
    mpSalePrice: number | null
    barcode: string | null
    skuInfo: unknown | null
    statusName: string | null
  }
  export function extractProductItems(detail: SellerProductDetail): CoupangProductItemRow[]
  ```
  Task 6(모델), Task 7(수집)이 사용한다.

한 `item` 객체 안에 RG·MP `vendorItemId` 가 나란히 있다. 축별로 행을 나누지 않고 **item 당 1행**을 만든다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// worker/src/coupang-api/__tests__/product-items.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractProductItems } from '../endpoints.js'
import type { SellerProductDetail } from '../endpoints.js'

// prod 실물 응답에서 가져온 한 item — 핸드오프의 65,790 / 67,800 쌍.
const REAL: SellerProductDetail = {
  sellerProductId: 16324130475,
  sellerProductName: '크림드 선 클렌징 패드 60매',
  statusName: '승인완료',
  items: [
    {
      itemName: '60매 1개',
      rocketGrowthItemData: {
        vendorItemId: 96037831212,
        priceData: { originalPrice: 35000, salePrice: 65790, supplyPrice: 63619 },
        barcode: '8809903551648',
        skuInfo: { width: 90, length: 90, height: 80, weight: 250, quantityPerBox: 1 },
      },
      marketplaceItemData: {
        vendorItemId: 95847019386,
        priceData: { originalPrice: 105000, salePrice: 67800, supplyPrice: 65563 },
        barcode: '',
      },
    },
  ],
} as unknown as SellerProductDetail

test('item 당 1행 — RG·MP 두 축이 한 행에 들어간다', () => {
  const rows = extractProductItems(REAL)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].rgVendorItemId, '96037831212')
  assert.equal(rows[0].mpVendorItemId, '95847019386')
})

test('가격은 priceData.salePrice 2단 중첩에서 읽는다', () => {
  const [row] = extractProductItems(REAL)
  // 평면 salePrice 로 선언했다면 여기서 null 이 나왔을 것 — 무음 실패 유형 3 과 같은 자리.
  assert.equal(row.rgSalePrice, 65790)
  assert.equal(row.mpSalePrice, 67800)
})

test('바코드는 RG 쪽만 채운다 — MP 는 빈 문자열이라 null 로 정규화', () => {
  const [row] = extractProductItems(REAL)
  assert.equal(row.barcode, '8809903551648')
})

test('RG 전용 상품 — MP 필드는 전부 null', () => {
  const rgOnly = {
    sellerProductId: 1,
    items: [
      { itemName: 'A', rocketGrowthItemData: { vendorItemId: 5, priceData: { salePrice: 100 } } },
    ],
  } as unknown as SellerProductDetail
  const [row] = extractProductItems(rgOnly)
  assert.equal(row.rgVendorItemId, '5')
  assert.equal(row.mpVendorItemId, null)
  assert.equal(row.mpSalePrice, null)
})

test('두 축 모두 없는 item 은 버린다 — 쓰기 타깃이 없다', () => {
  const empty = {
    sellerProductId: 1,
    items: [{ itemName: 'A' }],
  } as unknown as SellerProductDetail
  assert.equal(extractProductItems(empty).length, 0)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test worker/src/coupang-api/__tests__/product-items.test.ts`
Expected: FAIL — `extractProductItems is not a function`

- [ ] **Step 3: 타입과 함수를 추가한다**

`endpoints.ts` 의 `SellerProductDetailItem` 인터페이스에 중첩 데이터 형을 보강하고 함수를 추가한다.

```ts
export interface CoupangItemPriceData {
  originalPrice?: number
  salePrice?: number
  supplyPrice?: number
}

export interface CoupangAxisItemData {
  vendorItemId?: number
  priceData?: CoupangItemPriceData | null
  barcode?: string | null
  skuInfo?: unknown
  [key: string]: unknown
}

/** item 당 1행 — RG·MP 두 축이 한 행에 공존한다(축별 분리 불필요). */
export interface CoupangProductItemRow {
  sellerProductId: string
  itemName: string | null
  rgVendorItemId: string | null
  rgSalePrice: number | null
  mpVendorItemId: string | null
  mpSalePrice: number | null
  barcode: string | null
  skuInfo: unknown | null
  statusName: string | null
}

function axisId(data?: CoupangAxisItemData | null): string | null {
  return data?.vendorItemId == null ? null : String(data.vendorItemId)
}

function axisPrice(data?: CoupangAxisItemData | null): number | null {
  // 가격은 priceData.salePrice — 2단 중첩이다. 평면 salePrice 로 읽으면 전건 null 이 된다.
  const v = data?.priceData?.salePrice
  return typeof v === 'number' ? v : null
}

function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/**
 * 상품 단건 응답에서 적재용 행을 만든다.
 * 두 축 모두 vendorItemId 가 없으면 쓰기 타깃이 없으므로 버린다.
 */
export function extractProductItems(detail: SellerProductDetail): CoupangProductItemRow[] {
  const rows: CoupangProductItemRow[] = []
  const statusName = nonEmpty((detail as Record<string, unknown>).statusName)

  for (const item of detail.items ?? []) {
    const rg = item.rocketGrowthItemData as CoupangAxisItemData | null | undefined
    const mp = item.marketplaceItemData as CoupangAxisItemData | null | undefined
    const rgVendorItemId = axisId(rg)
    const mpVendorItemId = axisId(mp)
    if (!rgVendorItemId && !mpVendorItemId) continue

    rows.push({
      sellerProductId: String(detail.sellerProductId),
      itemName: nonEmpty(item.itemName),
      rgVendorItemId,
      rgSalePrice: axisPrice(rg),
      mpVendorItemId,
      mpSalePrice: axisPrice(mp),
      // 바코드·skuInfo 는 RG 쪽에만 있다(MP 는 빈 문자열).
      barcode: nonEmpty(rg?.barcode) ?? nonEmpty(mp?.barcode),
      skuInfo: rg?.skuInfo ?? null,
      statusName,
    })
  }
  return rows
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test worker/src/coupang-api/__tests__/product-items.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add worker/src/coupang-api/endpoints.ts worker/src/coupang-api/__tests__/product-items.test.ts
git commit -m "✨ feat(coupang-ads): 상품 item RG·MP 두 축 파싱 (item 당 1행)

가격은 priceData.salePrice 2단 중첩 — 평면으로 읽으면 전건 null."
```

---

## Task 5: 실호출 확인 (스파이크 · 폐기 코드)

**Files:**

- Create: `worker/tmp-verify-price-endpoints.ts` (**커밋하지 않는다**)

**Interfaces:**

- Consumes: Task 3·4 의 래퍼
- Produces: 없음 — 결과를 Task 3 Step 4 의 경로 수정과 §13 검증 기록에 반영한다

Task 3 의 조회 엔드포인트 경로는 추정이다. **읽기만 하고 아무것도 바꾸지 않는다.**

- [ ] **Step 1: 스크립트를 쓴다**

```ts
// worker/tmp-verify-price-endpoints.ts — 읽기 전용, 커밋하지 않음
import 'dotenv/config'
import fs from 'node:fs'
import { CoupangApiClient } from './src/coupang-api/client.js'
import {
  fetchSellerProducts,
  fetchSellerProduct,
  extractProductItems,
  fetchVendorItemStatus,
} from './src/coupang-api/endpoints.js'

const env = Object.fromEntries(
  fs
    .readFileSync(process.env.HOME + '/.config/workdeck/coupang-api.env', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=')
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ''),
      ]
    })
)
const client = new CoupangApiClient({
  vendorId: env.CP_VENDOR,
  accessKey: env.CP_AK,
  secretKey: env.CP_SK,
})

const products = await fetchSellerProducts(client, env.CP_VENDOR, {
  businessTypes: 'rocketGrowth',
})
const detail = await fetchSellerProduct(client, products[0].sellerProductId)
const rows = extractProductItems(detail)
console.log('행 수:', rows.length)
console.log(rows[0])

const target = rows.find((r) => r.rgVendorItemId)
if (target?.rgVendorItemId) {
  const status = await fetchVendorItemStatus(client, target.rgVendorItemId)
  console.log('조회 결과:', status)
  console.log('적재 가격과 일치?', status.salePrice === target.rgSalePrice)
}
```

- [ ] **Step 2: 실행한다**

Run: `cd worker && npx tsx tmp-verify-price-endpoints.ts`
Expected: 행이 출력되고 `조회 결과` 에 `salePrice` 가 찍힌다.

- [ ] **Step 3: 경로가 틀렸으면 고친다**

404 또는 IP 거부가 아닌 오류가 나면, 공식 문서 "상품 아이템별 수량/가격/상태 조회" 의 경로로 `fetchVendorItemStatus` 를 수정하고 **Task 3 의 테스트 URL 단언도 함께 고친다.**

Run: `npx tsx --test worker/src/coupang-api/__tests__/price-endpoints.test.ts`
Expected: PASS

- [ ] **Step 4: 스크립트를 지운다**

```bash
rm worker/tmp-verify-price-endpoints.ts
git status --short   # worker/tmp-* 가 남아 있지 않은지 확인
```

- [ ] **Step 5: 경로 수정이 있었으면 커밋**

```bash
git add worker/src/coupang-api/endpoints.ts worker/src/coupang-api/__tests__/price-endpoints.test.ts
git commit -m "🐛 fix(coupang-ads): 아이템 상태 조회 경로를 실호출 결과로 교정"
```

---

## Task 6: Prisma 모델 2종

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_coupang_price_write/migration.sql` (migrate dev 가 생성)

**Interfaces:**

- Consumes: 없음
- Produces: `prisma.coupangProductItem`, `prisma.coupangWriteJob`. Task 7 이후 전부가 사용한다.

- [ ] **Step 1: 스키마를 추가한다**

`prisma/schema.prisma` 의 `CoupangSourceSetting` 아래에 넣는다.

```prisma
// 쿠팡 상품 API 스냅샷 — item 당 1행(한 item 안에 RG·MP vendorItemId 가 공존).
// CoupangSourceSetting(CRAWL/API 소스 전환 토글)과 무관하다. 이건 소스 전환이 아니라
// 크롤링이 주지 못하는 보강 데이터다.
model CoupangProductItem {
  id              String  @id @default(cuid())
  spaceId         String
  sellerProductId String // Wing 딥링크의 vendorInventoryId 와 같은 값
  itemName        String?

  rgVendorItemId String? // 로켓그로스 축 — items[].rocketGrowthItemData.vendorItemId
  rgSalePrice    Int?
  mpVendorItemId String? // 마켓플레이스(판매자배송) 축
  mpSalePrice    Int?

  barcode    String? // RG 쪽에만 존재
  skuInfo    Json? // RG 전용 — 치수·무게·quantityPerBox·유통기한
  statusName String?

  // 지연 매핑 저장소 — 사용 시점에 사람이 확정한 ProductListing 연결.
  listingId String? @unique

  collectedAt DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  space   Space           @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  listing ProductListing? @relation(fields: [listingId], references: [id], onDelete: SetNull)

  @@unique([spaceId, rgVendorItemId])
  @@unique([spaceId, mpVendorItemId])
  @@index([spaceId, sellerProductId])
}

enum CoupangWriteJobKind {
  PRICE_CHANGE
  PRODUCT_SYNC
}

enum CoupangWriteJobStatus {
  PENDING
  RUNNING
  SUCCEEDED
  PARTIAL
  FAILED
}

// 앱은 쿠팡 API 를 호출할 수 없다(IP allowlist). 승인된 액션의 execute() 는 이 행만
// 만들고, 워커가 폴링해 실제 호출을 수행한다 — manual-poller 와 같은 패턴.
model CoupangWriteJob {
  id          String                @id @default(cuid())
  workspaceId String // 워커 폴링·자격 조회 축
  spaceId     String // 결과 반영 축(CoupangProductItem·알림)
  actionId    String?               @unique // AgentPendingAction.id — 멱등. PRODUCT_SYNC 는 null
  kind        CoupangWriteJobKind
  status      CoupangWriteJobStatus @default(PENDING)
  payload     Json
  results     Json? // 타깃별 { vendorItemId, observedPrice, ok, error }
  error       String?
  attempts    Int                   @default(0)
  claimedAt   DateTime?
  executedAt  DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  space     Space     @relation(fields: [spaceId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
  @@index([workspaceId, status])
  @@index([spaceId, createdAt])
}
```

`Space` 모델에 `coupangProductItems CoupangProductItem[]` 와 `coupangWriteJobs CoupangWriteJob[]`, `Workspace` 모델에 `coupangWriteJobs CoupangWriteJob[]`, `ProductListing` 모델에 `coupangProductItem CoupangProductItem?` 관계 필드를 추가한다.

- [ ] **Step 2: 마이그레이션을 만든다**

Run: `npx prisma migrate dev --name coupang_price_write`
Expected: 마이그레이션 파일 생성 + dev DB 적용 + 클라이언트 재생성

⚠️ shadow DB 오류(`storage.buckets` 등)가 나면 메모리 `reference_migrate_shadow_bypass` 의 hand-written 마이그레이션 절차를 따른다.

- [ ] **Step 3: 타입이 생성됐는지 확인한다**

Run: `npx tsc --noEmit`
Expected: 통과

- [ ] **Step 4: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations src/generated
git commit -m "✨ feat(coupang-ads): CoupangProductItem·CoupangWriteJob 모델 추가"
```

---

## Task 7: 상품 수집 (워커 → 앱 적재 → cron)

**Files:**

- Create: `worker/src/write-jobs/product-sync.ts`
- Modify: `worker/src/api-client.ts`
- Create: `app/api/coupang/product-items/route.ts`
- Create: `app/api/cron/coupang-product-sync/route.ts`
- Modify: `vercel.json`
- Test: `src/lib/coupang/__tests__/product-items-upsert.e2e.test.ts`

**Interfaces:**

- Consumes: Task 4 의 `extractProductItems`, Task 6 의 모델
- Produces:

  ```ts
  // worker/src/api-client.ts
  export async function upsertProductItems(
    spaceId: string,
    rows: CoupangProductItemRow[]
  ): Promise<{ upserted: number }>

  // src/lib/coupang/product-items.ts
  export async function upsertCoupangProductItems(
    spaceId: string,
    rows: CoupangProductItemRowInput[]
  ): Promise<number>
  ```

  Task 10 의 미리보기가 적재 결과를 읽는다.

- [ ] **Step 1: 적재 함수의 실패하는 테스트를 쓴다**

```ts
// src/lib/coupang/__tests__/product-items-upsert.e2e.test.ts
// @jest-environment node
import { prisma } from '@/lib/prisma'
import { upsertCoupangProductItems } from '../product-items'

// 시드는 기존 e2e 테스트(src/lib/agent/actions/__tests__/state-machine.e2e.test.ts)의
// Space 생성 패턴을 그대로 쓴다.

test('재수집 시 같은 rgVendorItemId 는 갱신되고 listingId 는 보존된다', async () => {
  await upsertCoupangProductItems(spaceId, [
    {
      sellerProductId: '15310472532',
      itemName: '누드 3P 2XL',
      rgVendorItemId: '96037831212',
      rgSalePrice: 65790,
      mpVendorItemId: '95847019386',
      mpSalePrice: 67800,
      barcode: '8809903551648',
      skuInfo: { weight: 250 },
      statusName: '승인완료',
    },
  ])

  const listing = await prisma.productListing.findFirstOrThrow({ where: { spaceId } })
  await prisma.coupangProductItem.updateMany({
    where: { spaceId, rgVendorItemId: '96037831212' },
    data: { listingId: listing.id },
  })

  // 가격만 바뀐 재수집
  await upsertCoupangProductItems(spaceId, [
    {
      sellerProductId: '15310472532',
      itemName: '누드 3P 2XL',
      rgVendorItemId: '96037831212',
      rgSalePrice: 66000,
      mpVendorItemId: '95847019386',
      mpSalePrice: 67800,
      barcode: '8809903551648',
      skuInfo: { weight: 250 },
      statusName: '승인완료',
    },
  ])

  const rows = await prisma.coupangProductItem.findMany({ where: { spaceId } })
  expect(rows).toHaveLength(1) // 중복 생성되지 않는다
  expect(rows[0].rgSalePrice).toBe(66000)
  expect(rows[0].listingId).toBe(listing.id) // 사람이 확정한 매핑이 수집으로 지워지지 않는다
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest -c jest.config.e2e.ts src/lib/coupang/__tests__/product-items-upsert.e2e.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 적재 함수를 구현한다**

```ts
// src/lib/coupang/product-items.ts
import { prisma } from '@/lib/prisma'

export type CoupangProductItemRowInput = {
  sellerProductId: string
  itemName: string | null
  rgVendorItemId: string | null
  rgSalePrice: number | null
  mpVendorItemId: string | null
  mpSalePrice: number | null
  barcode: string | null
  skuInfo: unknown | null
  statusName: string | null
}

/**
 * 수집 결과를 적재한다. listingId 는 사람이 확정한 매핑이므로 절대 덮지 않는다.
 * 키는 rgVendorItemId 우선, 없으면 mpVendorItemId(마켓플레이스 전용 상품).
 */
export async function upsertCoupangProductItems(
  spaceId: string,
  rows: CoupangProductItemRowInput[]
): Promise<number> {
  const collectedAt = new Date()
  let n = 0

  for (const row of rows) {
    const where = row.rgVendorItemId
      ? { spaceId_rgVendorItemId: { spaceId, rgVendorItemId: row.rgVendorItemId } }
      : row.mpVendorItemId
        ? { spaceId_mpVendorItemId: { spaceId, mpVendorItemId: row.mpVendorItemId } }
        : null
    if (!where) continue

    const data = {
      sellerProductId: row.sellerProductId,
      itemName: row.itemName,
      rgVendorItemId: row.rgVendorItemId,
      rgSalePrice: row.rgSalePrice,
      mpVendorItemId: row.mpVendorItemId,
      mpSalePrice: row.mpSalePrice,
      barcode: row.barcode,
      skuInfo: row.skuInfo === null ? undefined : (row.skuInfo as object),
      statusName: row.statusName,
      collectedAt,
    }

    await prisma.coupangProductItem.upsert({
      where,
      // listingId 를 create/update 어느 쪽에도 쓰지 않는다 — 수집이 매핑을 지우면 안 된다.
      create: { spaceId, ...data },
      update: data,
    })
    n += 1
  }
  return n
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest -c jest.config.e2e.ts src/lib/coupang/__tests__/product-items-upsert.e2e.test.ts`
Expected: PASS

- [ ] **Step 5: 워커 적재 라우트를 만든다**

`app/api/coupang/product-items/route.ts` — 워커 인증은 `src/lib/api-helpers.ts` 의 기존 워커 키 검증 방식(다른 `/api/collection/*` 라우트 참조)을 그대로 따른다.

```ts
import { NextResponse } from 'next/server'
import { upsertCoupangProductItems } from '@/lib/coupang/product-items'
// 워커 인증 헬퍼는 app/api/collection/source-setting/route.ts 에서 쓰는 것과 동일한 것을 import 한다.

export const runtime = 'nodejs'

export async function POST(request: Request) {
  // 1) 워커 API 키 검증 (기존 /api/collection/* 과 동일)
  // 2) body { spaceId, rows } 파싱
  const body = (await request.json()) as {
    spaceId?: string
    rows?: Parameters<typeof upsertCoupangProductItems>[1]
  }
  if (!body.spaceId || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'spaceId 와 rows 가 필요합니다' }, { status: 400 })
  }
  const upserted = await upsertCoupangProductItems(body.spaceId, body.rows)
  return NextResponse.json({ upserted })
}
```

- [ ] **Step 6: 워커 수집 잡을 만든다**

```ts
// worker/src/write-jobs/product-sync.ts
/**
 * 상품 API 전체 순회 → 앱 적재.
 * 상품 55개 × 1.3초 스로틀 ≈ 70초. 목록 조회는 businessTypes=rocketGrowth 필수.
 */
import type { CoupangApiClient } from '../coupang-api/client.js'
import {
  fetchSellerProducts,
  fetchSellerProduct,
  extractProductItems,
  type CoupangProductItemRow,
} from '../coupang-api/endpoints.js'
import { upsertProductItems } from '../api-client.js'

export async function runProductSync(
  client: CoupangApiClient,
  vendorId: string,
  spaceId: string
): Promise<{ products: number; rows: number }> {
  const products = await fetchSellerProducts(client, vendorId, {
    businessTypes: 'rocketGrowth',
  })

  const rows: CoupangProductItemRow[] = []
  for (const p of products) {
    try {
      const detail = await fetchSellerProduct(client, p.sellerProductId)
      rows.push(...extractProductItems(detail))
    } catch (err) {
      // 한 상품이 실패해도 나머지를 버리지 않는다. 다음 수집에서 복구된다.
      console.warn(
        `[product-sync] 단건 조회 실패(sellerProductId=${p.sellerProductId}):`,
        err instanceof Error ? err.message : err
      )
    }
  }

  await upsertProductItems(spaceId, rows)
  return { products: products.length, rows: rows.length }
}
```

`worker/src/api-client.ts` 에 추가한다. **응답 래퍼를 반드시 벗긴다** — 이 프로젝트의 무음 실패 유형 1·2가 전부 래퍼 미해제였다.

```ts
export async function upsertProductItems(
  spaceId: string,
  rows: unknown[]
): Promise<{ upserted: number }> {
  const response = await workerFetch('/api/coupang/product-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId, rows }),
  })
  const data = await response.json()
  return { upserted: Number(data?.upserted ?? 0) }
}
```

- [ ] **Step 7: cron 라우트를 만든다**

```ts
// app/api/cron/coupang-product-sync/route.ts
import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'

/**
 * GET /api/cron/coupang-product-sync — Vercel cron 전용.
 *
 * 매일 상품 API 수집 잡을 만든다. 워커에 스케줄 로직을 두지 않는 이유:
 * "하루 1회"를 DB 가 보장해야 워커 재기동에도 중복이 없고, 정기 크롤링
 * 스케줄러(Playwright·Akamai 쿨다운)와 생명주기를 분리할 수 있다.
 */
export const GET = withCronRun('/api/cron/coupang-product-sync', async () => {
  // 쿠팡 자격이 등록된 워크스페이스만 대상.
  const credentials = await prisma.coupangApiCredential.findMany({
    select: { workspaceId: true },
  })

  let created = 0
  for (const { workspaceId } of credentials) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    })
    if (!workspace) continue

    const spaceId = await resolveSpaceIdForWorkspace(workspaceId)
    if (!spaceId) continue

    // 오늘 이미 만든 잡이 있으면 건너뛴다 — cron 재시도에도 중복이 없다.
    const since = new Date(Date.now() - 20 * 60 * 60 * 1000)
    const existing = await prisma.coupangWriteJob.findFirst({
      where: { workspaceId, kind: 'PRODUCT_SYNC', createdAt: { gt: since } },
      select: { id: true },
    })
    if (existing) continue

    await prisma.coupangWriteJob.create({
      data: { workspaceId, spaceId, kind: 'PRODUCT_SYNC', payload: {} },
    })
    created += 1
  }

  return { created }
})
```

`resolveSpaceIdForWorkspace` 는 `src/lib/sh/margin-query.ts` 의 `resolveCoupangWorkspaceForSpace` 의 **역방향**이다. 그 함수를 먼저 읽고 같은 연결 테이블을 반대로 조회하는 헬퍼를 `src/lib/coupang/workspace-space.ts` 에 만든다.

`vercel.json` 의 `crons` 배열에 추가한다.

```json
{ "path": "/api/cron/coupang-product-sync", "schedule": "0 2 * * *" }
```

- [ ] **Step 8: 빌드를 확인한다**

Run: `npx tsc --noEmit && npm run lint`
Expected: 통과

- [ ] **Step 9: 커밋**

```bash
git add src/lib/coupang app/api/coupang/product-items app/api/cron/coupang-product-sync vercel.json worker/src/write-jobs/product-sync.ts worker/src/api-client.ts src/lib/coupang/__tests__
git commit -m "✨ feat(coupang-ads): 상품 API 일일 수집 + 적재

Vercel cron 이 잡을 만들고 워커가 폴링으로 집어간다.
listingId(사람이 확정한 매핑)는 수집으로 덮지 않는다."
```

---

## Task 8: 가격그룹 → 리스팅 유도 + 금액 가드

**Files:**

- Create: `src/lib/sh/coupang-price/price-round.ts`
- Create: `src/lib/sh/coupang-price/listing-derive.ts`
- Test: `src/lib/sh/coupang-price/__tests__/price-round.test.ts`
- Test: `src/lib/sh/coupang-price/__tests__/listing-derive.test.ts`

**Interfaces:**

- Consumes: 없음 (순수 함수)
- Produces:

  ```ts
  export function roundPriceTo10(v: number): number // 반올림
  export function ceilMinPriceTo10(v: number): number // 올림
  export type PriceGuardResult = { ok: true } | { ok: false; reason: string }
  export function checkPriceGuards(args: {
    price: number
    apMinSalePrice: number
    includeVat: boolean
  }): PriceGuardResult

  export type ListingSignature = { optionId: string; quantity: number }
  export function signatureOf(items: ListingSignature[]): string
  export function deriveListings(
    group: { optionIds: string[]; quantity: number },
    listings: Array<{ id: string; items: ListingSignature[] }>
  ): { matched: string[]; ambiguous: string[][] }
  ```

  Task 9(액션), Task 11(미리보기)이 사용한다.

- [ ] **Step 1: 금액 함수의 실패하는 테스트를 쓴다**

```ts
// src/lib/sh/coupang-price/__tests__/price-round.test.ts
import { roundPriceTo10, ceilMinPriceTo10, checkPriceGuards } from '../price-round'

describe('10원 단위', () => {
  test('판매가는 반올림', () => {
    expect(roundPriceTo10(48237)).toBe(48240)
    expect(roundPriceTo10(48234)).toBe(48230)
    expect(roundPriceTo10(48230)).toBe(48230)
  })

  test('자동조정 하한은 올림 — 내리면 마진 밑으로 팔릴 수 있다', () => {
    expect(ceilMinPriceTo10(58191)).toBe(58200)
    expect(ceilMinPriceTo10(58200)).toBe(58200)
  })
})

describe('가드', () => {
  test('includeVat=false 시나리오는 차단', () => {
    const r = checkPriceGuards({ price: 48240, apMinSalePrice: 40000, includeVat: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('VAT')
  })

  test('apMinSalePrice 가 price 이상이면 차단 — 쿠팡이 400 을 준다', () => {
    const r = checkPriceGuards({ price: 48240, apMinSalePrice: 48240, includeVat: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('최저가')
  })

  test('정상이면 통과', () => {
    expect(checkPriceGuards({ price: 48240, apMinSalePrice: 40000, includeVat: true })).toEqual({
      ok: true,
    })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest src/lib/sh/coupang-price/__tests__/price-round.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

```ts
// src/lib/sh/coupang-price/price-round.ts
/** 쿠팡 price 는 최소 10원 단위. 판매가는 반올림한다. */
export function roundPriceTo10(v: number): number {
  return Math.round(v / 10) * 10
}

/**
 * 자동조정 하한은 **올림**한다. 내림하면 쿠팡이 최소마진 밑으로 팔 수 있다.
 */
export function ceilMinPriceTo10(v: number): number {
  return Math.ceil(v / 10) * 10
}

export type PriceGuardResult = { ok: true } | { ok: false; reason: string }

export function checkPriceGuards(args: {
  price: number
  apMinSalePrice: number
  includeVat: boolean
}): PriceGuardResult {
  // 시뮬 salePrice 는 includeVat=true 일 때만 VAT 포함 실결제가다.
  // false 면 ex-VAT 라 그대로 밀면 10% 낮게 반영된다. 자동 gross-up 은 하지 않는다.
  if (!args.includeVat) {
    return {
      ok: false,
      reason: 'VAT 미포함 시나리오입니다. 쿠팡 판매가는 VAT 포함 금액이라 반영할 수 없습니다',
    }
  }
  if (!(args.apMinSalePrice < args.price)) {
    return {
      ok: false,
      reason: '자동조정 최저가가 판매가보다 낮아야 합니다',
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest src/lib/sh/coupang-price/__tests__/price-round.test.ts`
Expected: PASS

- [ ] **Step 5: 리스팅 유도의 실패하는 테스트를 쓴다**

```ts
// src/lib/sh/coupang-price/__tests__/listing-derive.test.ts
import { deriveListings } from '../listing-derive'

const group = { optionIds: ['op-green', 'op-beige', 'op-charcoal'], quantity: 1 }

test('구성 시그니처가 일치하는 리스팅을 색상 수만큼 찾는다', () => {
  const listings = [
    { id: 'L-green', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-beige', items: [{ optionId: 'op-beige', quantity: 1 }] },
    { id: 'L-charcoal', items: [{ optionId: 'op-charcoal', quantity: 1 }] },
    { id: 'L-green-2', items: [{ optionId: 'op-green', quantity: 2 }] }, // 수량 다름 → 제외
    { id: 'L-other', items: [{ optionId: 'op-xxx', quantity: 1 }] },
  ]
  const r = deriveListings(group, listings)
  expect(r.matched.sort()).toEqual(['L-beige', 'L-charcoal', 'L-green'])
  expect(r.ambiguous).toEqual([])
})

test('같은 구성 리스팅이 2개면 모호로 분류하고 matched 에 넣지 않는다', () => {
  const listings = [
    { id: 'L-a', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-b', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-beige', items: [{ optionId: 'op-beige', quantity: 1 }] },
  ]
  const r = deriveListings(group, listings)
  expect(r.matched).toEqual(['L-beige'])
  expect(r.ambiguous).toEqual([['L-a', 'L-b']])
})

test('구성품이 2종인 혼합 세트는 순서와 무관하게 같은 시그니처', () => {
  const mixed = { optionIds: ['op-a'], quantity: 1 }
  const listings = [
    {
      id: 'L-mix',
      items: [
        { optionId: 'op-b', quantity: 1 },
        { optionId: 'op-a', quantity: 1 },
      ],
    },
  ]
  // 단일 옵션 그룹은 2종 구성 리스팅과 일치하지 않는다.
  expect(deriveListings(mixed, listings).matched).toEqual([])
})
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx jest src/lib/sh/coupang-price/__tests__/listing-derive.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 7: 구현한다**

```ts
// src/lib/sh/coupang-price/listing-derive.ts
/**
 * 가격그룹 → 쿠팡 채널 리스팅 유도.
 *
 * 시뮬의 가격그룹은 optionIds[](같은 가격의 옵션 묶음) + quantity 를 갖고,
 * 리스팅은 ProductListingItem(optionId, quantity) 를 갖는다.
 * 구성 시그니처가 같으면 같은 판매 단위다.
 *
 * 이름 매칭은 쓰지 않는다 — ChannelProductAlias 가 같은 발상으로 매칭률 0 이었다.
 */
export type ListingSignature = { optionId: string; quantity: number }

export function signatureOf(items: ListingSignature[]): string {
  return items
    .map((i) => `${i.optionId}x${i.quantity}`)
    .sort()
    .join(',')
}

export function deriveListings(
  group: { optionIds: string[]; quantity: number },
  listings: Array<{ id: string; items: ListingSignature[] }>
): { matched: string[]; ambiguous: string[][] } {
  // 그룹의 각 옵션은 "그 옵션 × quantity" 단일 구성 리스팅에 대응한다.
  const wanted = new Map<string, string>() // signature -> optionId
  for (const optionId of group.optionIds) {
    wanted.set(signatureOf([{ optionId, quantity: group.quantity }]), optionId)
  }

  const bySig = new Map<string, string[]>()
  for (const l of listings) {
    const sig = signatureOf(l.items)
    if (!wanted.has(sig)) continue
    const arr = bySig.get(sig) ?? []
    arr.push(l.id)
    bySig.set(sig, arr)
  }

  const matched: string[] = []
  const ambiguous: string[][] = []
  for (const ids of bySig.values()) {
    if (ids.length === 1) matched.push(ids[0])
    else ambiguous.push([...ids].sort())
  }
  return { matched: matched.sort(), ambiguous }
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx jest src/lib/sh/coupang-price/__tests__/`
Expected: PASS (전 7 tests)

- [ ] **Step 9: 커밋**

```bash
git add src/lib/sh/coupang-price
git commit -m "✨ feat(coupang-ads): 가격그룹→리스팅 유도 + 10원 단위·VAT 가드

이름 매칭 대신 (optionId, quantity) 구성 시그니처로 잇는다.
동일 구성 리스팅이 2개면 모호로 분류해 사람이 고르게 한다."
```

---

## Task 9: 액션 정의 `seller-hub.coupang-price.change`

**Files:**

- Create: `src/lib/agent/actions/coupang-price.ts`
- Create: `src/lib/coupang/workspace-space.ts`
- Modify: `src/lib/agent/actions/registry.ts`
- Test: `src/lib/agent/actions/__tests__/coupang-price.e2e.test.ts`

**Interfaces:**

- Consumes: Task 6 의 모델, Task 8 의 가드
- Produces: `actionType: 'seller-hub.coupang-price.change'` 가 승인 시 `CoupangWriteJob(PRICE_CHANGE)` 를 만든다. Task 10 의 워커가 그 잡을 읽는다.

payload 형태 (Task 10·11 이 그대로 따른다):

```ts
{
  channelAxis: 'RG' | 'MP',
  channelId: string,
  apActive: boolean,
  targets: Array<{
    listingId: string
    vendorItemId: string
    listingName: string
    currentPrice: number | null   // 스냅샷 기준 참고값
    targetPrice: number           // 10원 반올림 완료
    apMinSalePrice: number        // 10원 올림 완료
  }>,
  rationale: {
    costPrice: number; channelFeePct: number; shippingCost: number
    targetMargin: number; computedMargin: number
    discountRate: number; promotionLabel: string | null
    includeVat: boolean; vatRate: number
  },
  scenarioId?: string
}
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/agent/actions/__tests__/coupang-price.e2e.test.ts
// @jest-environment node
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { approveAndExecute } from '../execute'

// 시드: Space + Workspace + 쿠팡 자격 + 쿠팡 채널 + ProductListing + CoupangProductItem

test('승인하면 CoupangWriteJob 이 생기고 쿠팡을 직접 호출하지 않는다', async () => {
  const draft = await createPendingAction({
    spaceId,
    actionType: 'seller-hub.coupang-price.change',
    params: {
      channelAxis: 'RG',
      channelId,
      apActive: true,
      targets: [
        {
          listingId,
          vendorItemId: '96037831212',
          listingName: '테스트 리스팅',
          currentPrice: 65790,
          targetPrice: 66000,
          apMinSalePrice: 58200,
        },
      ],
      rationale: {
        costPrice: 30000,
        channelFeePct: 0.1,
        shippingCost: 3000,
        targetMargin: 0.25,
        computedMargin: 0.27,
        discountRate: 0,
        promotionLabel: null,
        includeVat: true,
        vatRate: 0.1,
      },
    },
    summary: '쿠팡 로켓그로스 판매가 반영 — 1건',
    source: 'WEB',
    requestedBy: userId,
  })

  const action = await prisma.agentPendingAction.findUniqueOrThrow({
    where: { id: draft.actionId },
  })
  // 가격 액션은 6시간 만료
  const hours = (action.expiresAt.getTime() - action.createdAt.getTime()) / 3_600_000
  expect(Math.round(hours)).toBe(6)

  const res = await approveAndExecute(draft.actionId, userId)
  expect(res.ok).toBe(true)

  const job = await prisma.coupangWriteJob.findUniqueOrThrow({
    where: { actionId: draft.actionId },
  })
  expect(job.kind).toBe('PRICE_CHANGE')
  expect(job.status).toBe('PENDING')
})

test('VAT 미포함 시나리오는 액션 생성이 거부된다', async () => {
  await expect(
    createPendingAction({
      spaceId,
      actionType: 'seller-hub.coupang-price.change',
      params: {
        /* 위와 같되 rationale.includeVat: false */
      },
      summary: 'x',
      source: 'WEB',
      requestedBy: userId,
    })
  ).rejects.toThrow(/VAT/)
})

test('쿠팡 워크스페이스가 연결되지 않은 space 는 액션 생성이 거부된다', async () => {
  await expect(
    createPendingAction({
      spaceId: unlinkedSpaceId,
      actionType: 'seller-hub.coupang-price.change',
      params: {
        /* 정상 params */
      },
      summary: 'x',
      source: 'WEB',
      requestedBy: userId,
    })
  ).rejects.toThrow(/쿠팡/)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest -c jest.config.e2e.ts src/lib/agent/actions/__tests__/coupang-price.e2e.test.ts`
Expected: FAIL — `알 수 없는 액션 유형`

- [ ] **Step 3: workspace 해석 헬퍼를 만든다**

`src/lib/sh/margin-query.ts:229` 의 `resolveCoupangWorkspaceForSpace` 를 먼저 읽는다. 같은 연결을 쓰되 nullable 임을 유지한다.

```ts
// src/lib/coupang/workspace-space.ts
import { resolveCoupangWorkspaceForSpace } from '@/lib/sh/margin-query' // 실제 export 위치를 grep 으로 확인해 맞춘다

/**
 * space → 쿠팡 workspace. 미연결이면 null.
 * 이 축 혼동은 이미 버그로 나간 적 있다(54b2f882) — 추측으로 findFirst 하지 않는다.
 */
export async function requireCoupangWorkspaceId(spaceId: string): Promise<string> {
  const ws = await resolveCoupangWorkspaceForSpace(spaceId)
  if (!ws) throw new Error('쿠팡 워크스페이스가 연결되어 있지 않습니다')
  return ws.workspaceId
}
```

- [ ] **Step 4: 액션을 정의한다**

```ts
// src/lib/agent/actions/coupang-price.ts
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { checkPriceGuards } from '@/lib/sh/coupang-price/price-round'
import { requireCoupangWorkspaceId } from '@/lib/coupang/workspace-space'
import type { ActionDefinition } from './types'

const targetSchema = z.object({
  listingId: z.string(),
  vendorItemId: z.string(),
  listingName: z.string(),
  currentPrice: z.number().nullable(),
  targetPrice: z.number().int().positive(),
  apMinSalePrice: z.number().int().positive(),
})

const params = z.object({
  channelAxis: z.enum(['RG', 'MP']),
  channelId: z.string(),
  apActive: z.boolean(),
  targets: z.array(targetSchema).min(1),
  rationale: z.object({
    costPrice: z.number(),
    channelFeePct: z.number(),
    shippingCost: z.number(),
    targetMargin: z.number(),
    computedMargin: z.number(),
    discountRate: z.number(),
    promotionLabel: z.string().nullable(),
    includeVat: z.boolean(),
    vatRate: z.number(),
  }),
  scenarioId: z.string().optional(),
})

type Params = z.infer<typeof params>

export const coupangPriceChange: ActionDefinition<Params> = {
  actionType: 'seller-hub.coupang-price.change',
  // 가격 변경은 광고가 아니고, 사용자가 되돌아갈 화면이 가격시뮬(seller-hub)이다.
  deckKey: 'seller-hub',
  title: '쿠팡 판매가 반영',
  paramsSchema: params.superRefine((v, ctx) => {
    for (const t of v.targets) {
      const guard = checkPriceGuards({
        price: t.targetPrice,
        apMinSalePrice: t.apMinSalePrice,
        includeVat: v.rationale.includeVat,
      })
      if (!guard.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: guard.reason })
      }
      if (t.targetPrice % 10 !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '판매가는 10원 단위여야 합니다',
        })
      }
    }
  }) as unknown as z.ZodType<Params>,
  requiredRole: 'ADMIN',

  // 승인 시점의 스냅샷 가격. 차단용이 아니라 감사용이다 —
  // 자동조정이 켜진 옵션은 이 값과 실행 시점 가격이 다른 것이 정상이다.
  snapshot: async (ctx, p) =>
    prisma.coupangProductItem.findMany({
      where: { spaceId: ctx.spaceId, listingId: { in: p.targets.map((t) => t.listingId) } },
      select: { listingId: true, rgSalePrice: true, mpSalePrice: true, collectedAt: true },
    }),

  // 쿠팡 API 는 allowlist IP(워커)에서만 호출된다. 여기서는 잡만 만든다.
  execute: async (ctx, p) => {
    const workspaceId = await requireCoupangWorkspaceId(ctx.spaceId)
    const job = await prisma.coupangWriteJob.create({
      data: {
        workspaceId,
        spaceId: ctx.spaceId,
        kind: 'PRICE_CHANGE',
        payload: p as unknown as object,
      },
    })
    return { jobId: job.id, status: 'queued', targets: p.targets.length }
  },
}
```

`registry.ts` 의 `allActions` 배열에 `coupangPriceChange` 를 추가한다.

- [ ] **Step 5: 6시간 만료를 적용한다**

`src/lib/agent/actions/create.ts` 의 `expiresAt` 계산(now+72h)을 읽고, actionType 별 만료를 허용하도록 고친다. `ActionDefinition` 에 선택 필드를 추가한다.

```ts
// types.ts — ActionDefinition 에 추가
  /** 승인 유효기간(시간). 미지정 시 기본 72. 실판매가를 바꾸는 액션은 짧게 둔다. */
  expiryHours?: number
```

```ts
// create.ts — expiresAt 계산부
const expiryHours = def.expiryHours ?? 72
const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000)
```

`coupang-price.ts` 의 정의에 `expiryHours: 6` 을 추가한다.

- [ ] **Step 6: 통과를 확인한다**

Run: `npx jest -c jest.config.e2e.ts src/lib/agent/actions/__tests__/coupang-price.e2e.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: 기존 액션 회귀를 확인한다**

Run: `npx jest -c jest.config.e2e.ts src/lib/agent/actions/__tests__/`
Expected: PASS — 기존 state-machine 테스트가 72시간 기본값으로 계속 통과

- [ ] **Step 8: 커밋**

```bash
git add src/lib/agent/actions src/lib/coupang/workspace-space.ts
git commit -m "✨ feat(coupang-ads): 쿠팡 판매가 반영 액션 (승인 큐)

execute() 는 CoupangWriteJob 만 만든다 — 쿠팡 API 는 allowlist IP(워커)
에서만 호출된다. 가격 액션은 만료 6시간."
```

---

## Task 10: 워커 실행기 (폴링 + 가격 쓰기 + stale 회수)

**Files:**

- Create: `worker/src/coupang-write-poller.ts`
- Create: `worker/src/write-jobs/price-change.ts`
- Modify: `worker/src/api-client.ts`
- Modify: `worker/src/index.ts`
- Create: `app/api/coupang/write-jobs/claim/route.ts`
- Create: `app/api/coupang/write-jobs/[jobId]/report/route.ts`
- Create: `app/api/cron/coupang-write-jobs-reap/route.ts`
- Modify: `vercel.json`
- Test: `worker/src/write-jobs/__tests__/price-change.test.ts`

**Interfaces:**

- Consumes: Task 3 의 `changeVendorItemPrice`·`fetchVendorItemStatus`, Task 7 의 `runProductSync`, Task 9 의 payload 형태
- Produces:

  ```ts
  export type PriceTargetResult = {
    vendorItemId: string
    listingId: string
    observedPrice: number | null
    ok: boolean
    error: string | null
  }
  export async function runPriceChange(
    client: CoupangApiClient,
    payload: unknown
  ): Promise<PriceTargetResult[]>
  ```

  Task 12 의 Slack 알림이 `results` 를 읽는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// worker/src/write-jobs/__tests__/price-change.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPriceChange } from '../price-change.js'

// client 를 최소 stub 으로 대체 — 네트워크를 타지 않는다.
function stubClient(behaviour: {
  status?: (id: string) => { salePrice: number }
  put?: (id: string) => void
}) {
  return {
    get: async (path: string) => {
      const id = path.split('/vendor-items/')[1].split('/')[0]
      const s = behaviour.status?.(id) ?? { salePrice: 0 }
      return { data: { sellerItemId: Number(id), amountInStock: 1, ...s, onSale: true } }
    },
    put: async (path: string) => {
      const id = path.split('/vendor-items/')[1].split('/')[0]
      behaviour.put?.(id)
      return {
        body: { code: '200', message: '', data: { code: 'SUCCESS', message: '', data: 1 } },
        status: 200,
      }
    },
  } as never
}

const payload = {
  channelAxis: 'RG',
  apActive: true,
  targets: [
    { listingId: 'L1', vendorItemId: '111', targetPrice: 1000, apMinSalePrice: 900 },
    { listingId: 'L2', vendorItemId: '222', targetPrice: 2000, apMinSalePrice: 1800 },
  ],
}

test('타깃마다 observedPrice 를 기록하고 PUT 한다', async () => {
  const puts: string[] = []
  const results = await runPriceChange(
    stubClient({ status: () => ({ salePrice: 999 }), put: (id) => puts.push(id) }),
    payload
  )
  assert.deepEqual(puts, ['111', '222'])
  assert.equal(results.length, 2)
  assert.equal(results[0].observedPrice, 999)
  assert.equal(results[0].ok, true)
})

test('현재가가 목표가와 달라도 중단하지 않는다 — 자동조정이 가격을 움직인다', async () => {
  const results = await runPriceChange(
    stubClient({ status: () => ({ salePrice: 12345 }) }),
    payload
  )
  assert.equal(
    results.every((r) => r.ok),
    true
  )
})

test('한 타깃이 실패해도 나머지를 계속 처리한다', async () => {
  const client = {
    get: async () => ({ data: { salePrice: 100 } }),
    put: async (path: string) => {
      if (path.includes('/111/')) throw new Error('쿠팡 쓰기 실패: 삭제된 상품')
      return {
        body: { code: '200', message: '', data: { code: 'SUCCESS', message: '', data: 1 } },
        status: 200,
      }
    },
  } as never
  const results = await runPriceChange(client, payload)
  assert.equal(results[0].ok, false)
  assert.match(results[0].error ?? '', /삭제된 상품/)
  assert.equal(results[1].ok, true)
})

test('현재가 조회가 실패해도 PUT 은 시도한다 — 조회는 감사용이다', async () => {
  const puts: string[] = []
  const client = {
    get: async () => {
      throw new Error('일시 오류')
    },
    put: async (path: string) => {
      puts.push(path)
      return {
        body: { code: '200', message: '', data: { code: 'SUCCESS', message: '', data: 1 } },
        status: 200,
      }
    },
  } as never
  const results = await runPriceChange(client, payload)
  assert.equal(puts.length, 2)
  assert.equal(results[0].observedPrice, null)
  assert.equal(results[0].ok, true)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test worker/src/write-jobs/__tests__/price-change.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 가격 쓰기 잡을 구현한다**

```ts
// worker/src/write-jobs/price-change.ts
/**
 * 가격 변경 잡 — 타깃 순차 PUT.
 *
 * 현재가 조회는 **감사용**이다. 자동 가격조정이 켜진 옵션은 설계상 가격이 수시로
 * 바뀌므로 "미리보기 시점 가격과 다르면 중단"은 틀린 가드다(대부분의 쓰기가 막힌다).
 * 승인자가 결정한 것은 "판매가를 X로, 하한을 Y로"이지 "현재가가 Z일 때만"이 아니다.
 *
 * 부분 실패는 롤백하지 않는다. 성공한 건 성공으로 두고 건별 결과를 남긴다.
 */
import type { CoupangApiClient } from '../coupang-api/client.js'
import { changeVendorItemPrice, fetchVendorItemStatus } from '../coupang-api/endpoints.js'

export type PriceTargetResult = {
  vendorItemId: string
  listingId: string
  observedPrice: number | null
  ok: boolean
  error: string | null
}

type Payload = {
  apActive: boolean
  targets: Array<{
    listingId: string
    vendorItemId: string
    targetPrice: number
    apMinSalePrice: number
  }>
}

export async function runPriceChange(
  client: CoupangApiClient,
  payload: unknown
): Promise<PriceTargetResult[]> {
  const p = payload as Payload
  const results: PriceTargetResult[] = []

  for (const t of p.targets) {
    let observedPrice: number | null = null
    try {
      const status = await fetchVendorItemStatus(client, t.vendorItemId)
      observedPrice = typeof status?.salePrice === 'number' ? status.salePrice : null
    } catch (err) {
      // 조회 실패는 감사 정보 손실일 뿐 쓰기를 막지 않는다.
      console.warn(
        `[price-change] 현재가 조회 실패(vendorItemId=${t.vendorItemId}):`,
        err instanceof Error ? err.message : err
      )
    }

    try {
      await changeVendorItemPrice(client, {
        vendorItemId: t.vendorItemId,
        price: t.targetPrice,
        apActive: p.apActive,
        apMinSalePrice: t.apMinSalePrice,
      })
      results.push({
        vendorItemId: t.vendorItemId,
        listingId: t.listingId,
        observedPrice,
        ok: true,
        error: null,
      })
    } catch (err) {
      results.push({
        vendorItemId: t.vendorItemId,
        listingId: t.listingId,
        observedPrice,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test worker/src/write-jobs/__tests__/price-change.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: claim·report 라우트를 만든다**

`app/api/coupang/write-jobs/claim/route.ts` — 경합 방지를 위해 `updateMany` 게이트를 쓴다(`approveAndExecute` 와 같은 패턴).

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
// 워커 API 키 검증은 기존 /api/collection/* 과 동일하게 적용한다.

export const runtime = 'nodejs'

export async function POST() {
  const candidate = await prisma.coupangWriteJob.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!candidate) return NextResponse.json({ job: null })

  // 경합 패자는 count=0 — 다음 폴링에서 다른 잡을 집는다.
  const gate = await prisma.coupangWriteJob.updateMany({
    where: { id: candidate.id, status: 'PENDING' },
    data: { status: 'RUNNING', claimedAt: new Date(), attempts: { increment: 1 } },
  })
  if (gate.count !== 1) return NextResponse.json({ job: null })

  const job = await prisma.coupangWriteJob.findUnique({
    where: { id: candidate.id },
    select: { id: true, workspaceId: true, spaceId: true, kind: true, payload: true },
  })
  return NextResponse.json({ job })
}
```

`app/api/coupang/write-jobs/[jobId]/report/route.ts`

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyWriteJobResult } from '@/lib/slack/notify-write-job-result'
import { upsertCoupangProductItems } from '@/lib/coupang/product-items'

export const runtime = 'nodejs'

export async function POST(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params
  const body = (await request.json()) as {
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
    results?: Array<{ listingId: string; vendorItemId: string; ok: boolean; error: string | null }>
    error?: string
  }

  const job = await prisma.coupangWriteJob.update({
    where: { id: jobId },
    data: {
      status: body.status,
      results: (body.results ?? []) as unknown as object,
      error: body.error ?? null,
      executedAt: new Date(),
    },
  })

  // 성공한 타깃의 스냅샷 가격을 즉시 갱신해 미리보기가 낡지 않게 한다.
  if (job.kind === 'PRICE_CHANGE' && body.results?.length) {
    const payload = job.payload as {
      channelAxis: 'RG' | 'MP'
      targets: Array<{ listingId: string; targetPrice: number }>
    }
    for (const r of body.results.filter((x) => x.ok)) {
      const target = payload.targets.find((t) => t.listingId === r.listingId)
      if (!target) continue
      await prisma.coupangProductItem.updateMany({
        where: { spaceId: job.spaceId, listingId: r.listingId },
        data:
          payload.channelAxis === 'RG'
            ? { rgSalePrice: target.targetPrice }
            : { mpSalePrice: target.targetPrice },
      })
    }
  }

  await notifyWriteJobResult(jobId)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: 워커 폴러를 만든다**

```ts
// worker/src/coupang-write-poller.ts
/**
 * 쿠팡 쓰기 잡 폴링 — manual-poller 와 같은 패턴(30초, isProcessing 락).
 * 워커에는 HTTP 수신부가 없어 앱이 잡을 밀어줄 수 없다.
 */
import { claimWriteJob, reportWriteJob, getApiCredential } from './api-client.js'
import { decrypt } from './encryption.js'
import { CoupangApiClient } from './coupang-api/client.js'
import { runPriceChange } from './write-jobs/price-change.js'
import { runProductSync } from './write-jobs/product-sync.js'

const POLL_INTERVAL = 30_000
let isProcessing = false

export function startCoupangWritePoller(): void {
  setInterval(async () => {
    if (isProcessing) return
    let job: Awaited<ReturnType<typeof claimWriteJob>> = null
    try {
      job = await claimWriteJob()
      if (!job) return
      isProcessing = true

      const credential = await getApiCredential()
      if (!credential) throw new Error('쿠팡 API 자격이 등록되어 있지 않습니다')
      const client = new CoupangApiClient({
        vendorId: credential.vendorId,
        accessKey: decrypt(credential.accessKey),
        secretKey: decrypt(credential.secretKey),
      })

      if (job.kind === 'PRICE_CHANGE') {
        const results = await runPriceChange(client, job.payload)
        const okCount = results.filter((r) => r.ok).length
        await reportWriteJob(job.id, {
          status: okCount === results.length ? 'SUCCEEDED' : okCount === 0 ? 'FAILED' : 'PARTIAL',
          results,
        })
      } else {
        const summary = await runProductSync(client, credential.vendorId, job.spaceId)
        await reportWriteJob(job.id, { status: 'SUCCEEDED', results: [summary] })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[coupang-write-poller] 잡 실패:', message)
      if (job) {
        await reportWriteJob(job.id, { status: 'FAILED', error: message }).catch(() => {})
      }
    } finally {
      isProcessing = false
    }
  }, POLL_INTERVAL)

  console.log(`쿠팡 쓰기 잡 폴링 시작 (${POLL_INTERVAL / 1000}초 간격)`)
}
```

`worker/src/api-client.ts` 에 `claimWriteJob` · `reportWriteJob` 을 추가한다. **`claimWriteJob` 은 `{ job }` 래퍼를 반드시 벗긴다.**

`worker/src/index.ts` 에 `startCoupangWritePoller()` 를 등록한다.

- [ ] **Step 7: stale 회수 cron 을 만든다**

```ts
// app/api/cron/coupang-write-jobs-reap/route.ts
import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'

const STALE_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 2

/**
 * RUNNING 10분 초과 잡을 회수한다. 애플리케이션 레벨 재시도를 따로 두지 않는 이유:
 * 400 은 영구 실패, 429 는 client 가 이미 백오프, IP 거부는 전 스코프 문제다.
 * 재시도가 유효한 5xx·네트워크 실패는 워커 크래시와 구분되지 않아 이 회수 하나가 둘 다 덮는다.
 * 가격 PUT 은 자연 멱등이라 재실행이 안전하다.
 */
export const GET = withCronRun('/api/cron/coupang-write-jobs-reap', async () => {
  const threshold = new Date(Date.now() - STALE_MS)

  const failed = await prisma.coupangWriteJob.updateMany({
    where: { status: 'RUNNING', claimedAt: { lt: threshold }, attempts: { gt: MAX_ATTEMPTS } },
    data: { status: 'FAILED', error: '워커가 반복해서 중단됐습니다', executedAt: new Date() },
  })

  const requeued = await prisma.coupangWriteJob.updateMany({
    where: { status: 'RUNNING', claimedAt: { lt: threshold } },
    data: { status: 'PENDING', claimedAt: null },
  })

  return { failed: failed.count, requeued: requeued.count }
})
```

`vercel.json` 에 추가한다.

```json
{ "path": "/api/cron/coupang-write-jobs-reap", "schedule": "*/10 * * * *" }
```

- [ ] **Step 8: 전체 테스트와 빌드를 확인한다**

Run: `npx tsx --test worker/src/coupang-api/__tests__/*.test.ts worker/src/write-jobs/__tests__/*.test.ts`
Expected: PASS

Run: `npx tsc --noEmit && npm run lint`
Expected: 통과

- [ ] **Step 9: 커밋**

```bash
git add worker/src app/api/coupang app/api/cron/coupang-write-jobs-reap vercel.json
git commit -m "✨ feat(coupang-ads): 워커 쓰기 잡 폴러 + 가격 PUT + stale 회수

현재가 조회는 감사용이며 쓰기를 막지 않는다 — 자동조정이 켜진 옵션은
가격이 수시로 바뀌는 것이 정상이라 일치 가드가 틀린 설계다."
```

---

## Task 11: 결과 Slack 스레드 답글

**Files:**

- Create: `src/lib/slack/notify-write-job-result.ts`
- Test: `src/lib/slack/__tests__/notify-write-job-result.test.ts`

**Interfaces:**

- Consumes: Task 10 의 `results`, `AgentPendingAction.slackChannelId`·`slackMessageTs`
- Produces: `export async function notifyWriteJobResult(jobId: string): Promise<void>`

`notify-pending-action.ts:120` 이 이미 `slackChannelId`·`slackMessageTs` 를 저장한다. 같은 스레드에 답글을 단다.

- [ ] **Step 1: 문구 조립 함수의 실패하는 테스트를 쓴다**

메시지 조립을 순수 함수로 분리해 DB 없이 테스트한다.

```ts
// src/lib/slack/__tests__/notify-write-job-result.test.ts
import { buildResultText } from '../notify-write-job-result'

test('전건 성공', () => {
  const text = buildResultText({
    status: 'SUCCEEDED',
    results: [
      { listingName: 'A', ok: true, error: null },
      { listingName: 'B', ok: true, error: null },
    ],
  })
  expect(text).toContain('2건 중 2건 반영')
})

test('부분 실패 — 쿠팡 문구를 그대로 싣는다', () => {
  const text = buildResultText({
    status: 'PARTIAL',
    results: [
      { listingName: 'A', ok: true, error: null },
      {
        listingName: 'B',
        ok: false,
        error: '쿠팡 쓰기 실패: 변경전 판매가의 최대 50% 인하까지 변경가능합니다.',
      },
    ],
  })
  expect(text).toContain('2건 중 1건 실패')
  expect(text).toContain('최대 50% 인하')
  expect(text).toContain('B')
})

test('전건 실패', () => {
  const text = buildResultText({
    status: 'FAILED',
    results: [{ listingName: 'A', ok: false, error: '쿠팡 쓰기 실패: 삭제된 상품' }],
  })
  expect(text).toContain('실패')
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest src/lib/slack/__tests__/notify-write-job-result.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

```ts
// src/lib/slack/notify-write-job-result.ts
/**
 * 쓰기 잡 결과를 승인 알림 메시지의 **스레드 답글**로 보낸다.
 *
 * 규약: 모든 실패는 삼키고 console.error 만 남긴다(기존 알림 규약과 동일).
 * IP 거부는 여기서 다루지 않는다 — 액션 하나의 문제가 아니라 전 스코프가
 * 동시에 죽은 상황이라 기존 IP 거부 알림 경로로 따로 나간다.
 */
import { prisma } from '@/lib/prisma'
import { decryptBotToken } from './token-crypto'
import { postMessage } from './client'

export type ResultLine = { listingName: string; ok: boolean; error: string | null }

export function buildResultText(args: {
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
  results: ResultLine[]
}): string {
  const total = args.results.length
  const failed = args.results.filter((r) => !r.ok)

  if (failed.length === 0) {
    return `✅ 쿠팡 판매가 반영 완료 — ${total}건 중 ${total}건 반영`
  }

  const head =
    args.status === 'FAILED'
      ? `❌ 쿠팡 판매가 반영 실패 — ${total}건 전부 실패`
      : `⚠️ 쿠팡 판매가 부분 반영 — ${total}건 중 ${failed.length}건 실패`

  const lines = failed.map((r) => `• ${r.listingName}: ${r.error ?? '알 수 없는 오류'}`)
  return [head, ...lines].join('\n')
}

export async function notifyWriteJobResult(jobId: string): Promise<void> {
  try {
    const job = await prisma.coupangWriteJob.findUnique({
      where: { id: jobId },
      select: { actionId: true, status: true, results: true, spaceId: true },
    })
    if (!job?.actionId) return // PRODUCT_SYNC 등 승인과 무관한 잡

    const action = await prisma.agentPendingAction.findUnique({
      where: { id: job.actionId },
      select: { slackChannelId: true, slackMessageTs: true, payload: true },
    })
    // Slack 미연동 space 는 조용히 건너뛴다.
    if (!action?.slackChannelId || !action.slackMessageTs) return

    const payload = action.payload as {
      targets?: Array<{ listingId: string; listingName: string }>
    }
    const nameOf = (listingId: string) =>
      payload.targets?.find((t) => t.listingId === listingId)?.listingName ?? listingId

    const raw = (job.results ?? []) as Array<{
      listingId: string
      ok: boolean
      error: string | null
    }>
    const text = buildResultText({
      status: job.status as 'SUCCEEDED' | 'PARTIAL' | 'FAILED',
      results: raw.map((r) => ({ listingName: nameOf(r.listingId), ok: r.ok, error: r.error })),
    })

    const installation = await prisma.slackInstallation.findUnique({
      where: { spaceId: job.spaceId },
    })
    if (!installation) return

    await postMessage({
      token: decryptBotToken(installation),
      channel: action.slackChannelId,
      text,
      thread_ts: action.slackMessageTs,
    })
  } catch (err) {
    console.error('[notify-write-job-result] 알림 실패:', err)
  }
}
```

⚠️ `postMessage` 와 `decryptBotToken` 의 실제 시그니처를 `notify-pending-action.ts` 에서 확인해 맞춘다. `thread_ts` 를 받지 않으면 `postMessage` 에 선택 인자로 추가한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest src/lib/slack/__tests__/notify-write-job-result.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/slack
git commit -m "✨ feat(coupang-ads): 쓰기 결과를 승인 스레드 답글로 알림

slackChannelId/slackMessageTs 가 이미 저장돼 있어 thread_ts 만 얹으면 된다."
```

---

## Task 12: 미리보기 API

**Files:**

- Create: `src/lib/sh/coupang-price/build-targets.ts`
- Create: `app/api/sh/coupang-price/preview/route.ts`
- Create: `app/api/sh/coupang-price/link/route.ts`
- Test: `src/lib/sh/coupang-price/__tests__/build-targets.test.ts`

**Interfaces:**

- Consumes: Task 8 의 `deriveListings`·`roundPriceTo10`·`ceilMinPriceTo10`·`checkPriceGuards`
- Produces:

  ```ts
  export type PreviewTarget = {
    listingId: string
    listingName: string
    vendorItemId: string | null // null = 지연 매핑 미완료 → 피커 필요
    currentPrice: number | null
    snapshotAgeHours: number | null
    targetPrice: number
    apMinSalePrice: number
    deltaPct: number | null
    blockedReason: string | null
  }
  export function buildPreviewTargets(input: BuildTargetsInput): PreviewTarget[]
  ```

  Task 13 의 다이얼로그가 그대로 렌더한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/sh/coupang-price/__tests__/build-targets.test.ts
import { buildPreviewTargets } from '../build-targets'

const base = {
  channelAxis: 'RG' as const,
  salePrice: 48237, // 할인·프로모션 적용 전
  minMarginPrice: 40191,
  includeVat: true,
  now: new Date('2026-09-22T00:00:00Z'),
  listings: [
    { id: 'L1', name: '리스팅 A' },
    { id: 'L2', name: '리스팅 B' },
  ],
  items: [
    {
      listingId: 'L1',
      rgVendorItemId: '111',
      mpVendorItemId: '211',
      rgSalePrice: 47000,
      mpSalePrice: 47500,
      collectedAt: new Date('2026-09-21T00:00:00Z'),
    },
  ],
}

test('판매가는 10원 반올림, 하한은 10원 올림', () => {
  const [t] = buildPreviewTargets(base)
  expect(t.targetPrice).toBe(48240)
  expect(t.apMinSalePrice).toBe(40200)
})

test('매핑이 없는 리스팅은 vendorItemId 가 null 이고 차단 사유가 붙는다', () => {
  const targets = buildPreviewTargets(base)
  const l2 = targets.find((t) => t.listingId === 'L2')!
  expect(l2.vendorItemId).toBeNull()
  expect(l2.blockedReason).toContain('연결')
})

test('축에 맞는 현재가를 쓴다 — MP 축은 mpSalePrice', () => {
  const [t] = buildPreviewTargets({ ...base, channelAxis: 'MP' })
  expect(t.vendorItemId).toBe('211')
  expect(t.currentPrice).toBe(47500)
})

test('스냅샷 나이를 시간으로 준다', () => {
  const [t] = buildPreviewTargets(base)
  expect(t.snapshotAgeHours).toBe(24)
})

test('includeVat=false 는 전 타깃이 차단된다', () => {
  const targets = buildPreviewTargets({ ...base, includeVat: false })
  expect(targets.every((t) => t.blockedReason)).toBe(true)
})

test('하한이 판매가 이상이면 차단', () => {
  const targets = buildPreviewTargets({ ...base, minMarginPrice: 99999 })
  expect(targets[0].blockedReason).toContain('최저가')
})

test('변동률을 계산한다', () => {
  const [t] = buildPreviewTargets(base)
  // (48240 - 47000) / 47000
  expect(t.deltaPct).toBeCloseTo(0.0264, 3)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest src/lib/sh/coupang-price/__tests__/build-targets.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

```ts
// src/lib/sh/coupang-price/build-targets.ts
import { roundPriceTo10, ceilMinPriceTo10, checkPriceGuards } from './price-round'

export type BuildTargetsInput = {
  channelAxis: 'RG' | 'MP'
  /** 시뮬의 채널 판매가 — 할인·프로모션 적용 전 */
  salePrice: number
  /** recommendedRetail.min — 최소허용마진 달성가 */
  minMarginPrice: number
  includeVat: boolean
  now: Date
  listings: Array<{ id: string; name: string }>
  items: Array<{
    listingId: string
    rgVendorItemId: string | null
    mpVendorItemId: string | null
    rgSalePrice: number | null
    mpSalePrice: number | null
    collectedAt: Date
  }>
}

export type PreviewTarget = {
  listingId: string
  listingName: string
  vendorItemId: string | null
  currentPrice: number | null
  snapshotAgeHours: number | null
  targetPrice: number
  apMinSalePrice: number
  deltaPct: number | null
  blockedReason: string | null
}

export function buildPreviewTargets(input: BuildTargetsInput): PreviewTarget[] {
  const targetPrice = roundPriceTo10(input.salePrice)
  const apMinSalePrice = ceilMinPriceTo10(input.minMarginPrice)
  const guard = checkPriceGuards({
    price: targetPrice,
    apMinSalePrice,
    includeVat: input.includeVat,
  })
  const byListing = new Map(input.items.map((i) => [i.listingId, i]))

  return input.listings.map((l) => {
    const item = byListing.get(l.id)
    const vendorItemId = item
      ? input.channelAxis === 'RG'
        ? item.rgVendorItemId
        : item.mpVendorItemId
      : null
    const currentPrice = item
      ? input.channelAxis === 'RG'
        ? item.rgSalePrice
        : item.mpSalePrice
      : null

    const blockedReason = !guard.ok
      ? guard.reason
      : !vendorItemId
        ? '쿠팡 옵션이 연결되지 않았습니다. 연결한 뒤 반영할 수 있습니다'
        : null

    return {
      listingId: l.id,
      listingName: l.name,
      vendorItemId,
      currentPrice,
      snapshotAgeHours: item
        ? Math.round((input.now.getTime() - item.collectedAt.getTime()) / 3_600_000)
        : null,
      targetPrice,
      apMinSalePrice,
      deltaPct:
        currentPrice && currentPrice > 0 ? (targetPrice - currentPrice) / currentPrice : null,
      blockedReason,
    }
  })
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest src/lib/sh/coupang-price/__tests__/build-targets.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 라우트 2개를 만든다**

`app/api/sh/coupang-price/preview/route.ts` (POST) — body `{ channelId, optionIds, quantity, salePrice, minMarginPrice, includeVat }`.
`deriveListings` 로 리스팅을 유도하고, `CoupangProductItem` 을 `listingId` 로 조인한 뒤 `buildPreviewTargets` 를 호출한다. 응답에 `ambiguous` 도 실어 UI 가 피커를 띄우게 한다.

`app/api/sh/coupang-price/link/route.ts` (POST) — body `{ listingId, coupangProductItemId }`.
`spaceId` 소유를 검증하고 `CoupangProductItem.listingId` 를 갱신한다. 이미 다른 리스팅에 연결된 item 이면 400.

두 라우트 모두 `src/lib/api-helpers.ts` 의 기존 space 인증·역할 확인을 따른다.

- [ ] **Step 6: 빌드를 확인한다**

Run: `npx tsc --noEmit && npm run lint`
Expected: 통과

- [ ] **Step 7: 커밋**

```bash
git add src/lib/sh/coupang-price app/api/sh/coupang-price
git commit -m "✨ feat(coupang-ads): 쿠팡 판매가 미리보기·지연 매핑 API"
```

---

## Task 13: 미리보기 UI + 피커 + 버튼 + Wing 링크

**Files:**

- Create: `src/components/sh/products/pricing-sim/coupang-price-apply-dialog.tsx`
- Create: `src/components/sh/products/pricing-sim/coupang-item-picker-dialog.tsx`
- Modify: `src/components/sh/products/pricing-sim/pricing-channel-board-card.tsx`
- Modify: `src/components/sh/products/pricing-sim/pricing-quick-flow.tsx`
- Modify: `src/components/sh/products/listings/…` (판매채널 상품 목록에 Wing 링크)

**Interfaces:**

- Consumes: Task 12 의 `PreviewTarget`, `/api/sh/coupang-price/preview`·`/link`
- Produces: 없음 (최종 소비자)

- [ ] **Step 1: 버튼을 붙인다**

`pricing-channel-board-card.tsx:546` 의 `채널 상품 생성` 버튼 옆에, **쿠팡 채널일 때만** 노출되는 버튼을 추가한다. 채널 판별은 `externalSource` 와 `representativeChannelId` 로 한다 — 이름 휴리스틱을 쓰지 않는다.

```tsx
{
  isCoupangChannel && (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 gap-1 text-xs"
      disabled={!canApplyCoupang}
      onClick={() => onApplyCoupang?.(channel, salePriceBeforeDiscount, recommendedMin)}
    >
      <Upload className="h-3.5 w-3.5" />
      쿠팡 판매가로 반영 (₩{fmt(roundPriceTo10(salePriceBeforeDiscount))})
    </Button>
  )
}
```

⚠️ 넘기는 값은 `cell.finalPrice` 가 **아니다.** 바로 옆 `채널 상품 생성` 은 `cell.finalPrice`(할인·프로모션 후)를 쓰지만, 쿠팡 반영은 **할인·프로모션 적용 전 판매가**(`manualPrice ?? 권장가`)다. 사용자가 시뮬의 할인·프로모션을 참고해 실제 쿠팡 쿠폰을 운영하므로, `finalPrice` 를 밀면 이중 할인이 실제로 걸린다. 버튼 라벨에 금액을 박아 두 버튼의 숫자 차이를 눈에 보이게 한다.

- [ ] **Step 2: 미리보기 다이얼로그를 만든다**

`coupang-price-apply-dialog.tsx` 가 렌더할 것:

1. 타깃 표 — 리스팅명 · 현재가 · → · 목표가 · Δ% · 스냅샷 나이("1일 전 기준")
2. 미반영 고지 — `discountRate > 0` 또는 프로모션이 있으면
   > 이 시나리오에는 할인 N% / 프로모션 X가 있으나 쿠팡 판매가에는 반영되지 않습니다.
3. 자동 가격조정 블록 (기본 체크됨)
   ```
   ☑ 자동 가격조정 유지
      최저가  ₩58,200  (최소마진 12% 기준)
      ⚠ 쿠팡은 이 옵션의 현재 자동조정 상태를 알려주지 않습니다.
        체크를 해제하면 자동조정이 꺼집니다.
   ```
4. `blockedReason` 이 있는 행은 비활성 + 사유 표시. `vendorItemId` 가 null 이면 **[쿠팡 옵션 연결]** 버튼으로 피커를 연다
5. 제출 → `createPendingAction` 라우트 호출 → "승인 대기에 등록했습니다" 토스트 + `/approvals` 링크

- [ ] **Step 3: 피커를 만든다**

`coupang-item-picker-dialog.tsx`. 후보는 해당 space 의 `CoupangProductItem` 중 `listingId` 가 비어 있는 것.

검색은 **`@/lib/inv/search-tokens` 의 `tokenizeProductName` 을 재사용**한다. `option-picker-dialog.tsx:213` 의 "0건이면 마지막 토큰을 떼고 단계적 완화" 로직을 훅으로 추출해 두 다이얼로그가 공유한다(`src/components/sh/products/listings/use-token-search.ts`). 665줄짜리 다이얼로그를 제네릭화하지 않는다.

선택 시 `/api/sh/coupang-price/link` 호출 → 미리보기 재조회.

- [ ] **Step 4: Wing 딥링크를 붙인다**

`sellerProductId` = `vendorInventoryId` (실측 확인).

```ts
// src/lib/coupang/wing-link.ts
export function wingListingUrl(sellerProductId: string): string {
  return `https://wing.coupang.com/tenants/seller-web/vendor-inventory/modify?vendorInventoryId=${sellerProductId}`
}
```

붙일 자리:

- 가격시뮬 채널 보드 카드 (연결된 리스팅이 있을 때)
- 판매채널 상품 목록·상세

`target="_blank" rel="noopener noreferrer"` 로 연다. `CoupangProductItem` 연결이 없으면 링크를 노출하지 않는다.

- [ ] **Step 5: 로컬에서 확인한다**

Run: `npm run dev`

`/d/seller-ops/products` 의 가격시뮬에서 쿠팡 채널 보드를 열고 확인한다:

- 버튼 라벨의 금액이 `채널 상품 생성` 이 쓰는 금액과 **다른지**(할인이 있을 때)
- 미매핑 리스팅에서 피커가 뜨는지
- 자동조정 블록이 기본 체크 상태인지
- 제출 후 `/approvals` 에 액션이 뜨는지

- [ ] **Step 6: 빌드를 확인한다**

Run: `npm run build && npm run lint`
Expected: 통과

- [ ] **Step 7: 커밋**

```bash
git add src/components/sh src/lib/coupang/wing-link.ts
git commit -m "✨ feat(coupang-ads): 쿠팡 판매가 반영 UI + 지연 매핑 피커 + Wing 딥링크

반영 금액은 할인·프로모션 적용 전 판매가다 — 옆의 채널 상품 생성 버튼이
쓰는 finalPrice 와 다르므로 버튼 라벨에 금액을 박아 구분한다."
```

---

## Task 14: prod 실쓰기 검증

**Files:** 없음 (운영 절차)

**Interfaces:**

- Consumes: 배포된 전체 경로
- Produces: 검증 기록. §9 의 "파라미터 생략 시 자동조정 유지" 가정이 참인지 확정한다

preview 에서는 검증할 수 없다 — `ENCRYPTION_KEY` 가 없어 자격 복호화가 안 되고, IP allowlist 와 실자격이 prod 에만 있다.

- [ ] **Step 1: 배포한다**

`coupang-ads/wip` → `develop` → `main` 순서. 메모리 `feedback_worktree_release_flow` 를 따른다. 배포 후 **워커 프로세스를 kill** 한다(launchd 가 자동 재기동하며 새 코드를 로드한다).

- [ ] **Step 2: 대상 리스팅을 사용자에게 확인받는다**

조건: 판매가 적고 재고 여유가 있을 것. 주문이 적은 시간대.

- [ ] **Step 3: 1단계 — 자동조정 파라미터 없이 가격만**

미리보기에서 **자동 가격조정 체크를 해제**하는 것이 아니라, 이 1회만 `apActive`·`apMinSalePrice` 를 **전송하지 않는** 경로로 실행한다. 임시 플래그가 필요하면 워커 환경변수(`COUPANG_SKIP_AUTOPRICE=1`)로 두고 검증 후 제거한다.

목표가 = 현재가 + 10원.

확인할 것:

1. 쿠팡에 가격이 반영되는가
2. **기존 자동조정 설정이 유지되는가** ← 문서로 확인하지 못한 유일한 미지수

Wing 화면에서 사람이 눈으로 확인한다. 2번이 거짓이면 §9 를 재설계해야 한다.

- [ ] **Step 4: 원복한다**

같은 승인 흐름으로 원래 가격을 다시 민다. 롤백 경로가 함께 검증된다.

⚠️ 자동조정이 켜져 있으면 원복 후에도 쿠팡이 가격을 다시 움직인다. **"정확히 원래 숫자로 돌아왔는가"가 아니라 "우리 PUT 이 반영됐는가"로 판정한다.**

- [ ] **Step 5: 2단계 — 자동조정 포함**

`COUPANG_SKIP_AUTOPRICE` 없이 정상 경로로 실행한다. Wing 에서 자동조정 최저가가 반영됐는지 확인하고 원복한다.

- [ ] **Step 6: 임시 플래그를 제거하고 결과를 기록한다**

`COUPANG_SKIP_AUTOPRICE` 분기를 삭제하고, 3번의 2번 결과를 스펙 §9 에 실측으로 반영한다.

```bash
git add worker/src docs/decks/coupang-ads/prd/PRD_PRICE_WRITE_V1.md
git commit -m "🔧 chore(coupang-ads): 실쓰기 검증 임시 플래그 제거 + 자동조정 동작 실측 반영"
```

---

## Self-Review 결과

**스펙 커버리지**

| 스펙                                                         | 태스크                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| §3 쓰기 축(리스팅) · §3.1 시그니처 유도                      | Task 8                                                      |
| §4 채널 2개 · 채널별 승인                                    | Task 9(payload `channelAxis`), Task 13(버튼)                |
| §5 할인 전 판매가 · §5.1 VAT · §5.2 10원 · §5.3 force 미사용 | Task 8, Task 12, Task 13                                    |
| §6 지연 매핑 · §6.1 모델 · §6.2 수집                         | Task 6, 7, 12, 13                                           |
| §6.3 공통화(토큰 검색 훅만 추출)                             | Task 13 Step 3                                              |
| §7 실행 경로 · §7.3 근거 스냅샷 · §7.5 축 해석               | Task 9, 10                                                  |
| §7.4 가드 제거                                               | Task 10 Step 3 (테스트로 고정)                              |
| §7.6 워커 · 부분 실패                                        | Task 10                                                     |
| §8 Wing 딥링크                                               | Task 13 Step 4                                              |
| §9 자동 가격조정                                             | Task 3(전송), 8(하한 올림), 12(가드), 13(UI 블록), 14(실측) |
| §10 응답 파싱                                                | Task 2, 3                                                   |
| §12 안전장치                                                 | Task 1(만료), 8·12(가드), 9(역할), 10(감사)                 |
| §16.1 수집 트리거                                            | Task 7                                                      |
| §16.2 만료 게이트                                            | Task 1                                                      |
| §16.3 재시도·stale                                           | Task 10 Step 7                                              |
| §16.4 알림                                                   | Task 11                                                     |
| §13 검증                                                     | 각 태스크 + Task 14                                         |

**남은 불확실성 2건** (계획 안에서 해소하도록 단계를 넣어 둠)

1. `fetchVendorItemStatus` 경로가 추정 — Task 5 가 실호출로 확정한다
2. 자동조정 파라미터 생략 시 기존 설정 유지 여부 — Task 14 Step 3 이 실측한다
