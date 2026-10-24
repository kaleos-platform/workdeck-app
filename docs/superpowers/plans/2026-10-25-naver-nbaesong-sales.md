# 스마트스토어 N배송 판매 수집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 커머스API에서 N배송(위킵 3PL) 주문을 매일 수집해 판매분석·발주예측·공헌이익에 반영하고 위킵 위치 재고를 차감한다.

**Architecture:** N배송 주문을 **`DelOrder`/`DelOrderItem`(+Fulfillment)으로 적재**한다 — 판매분석(`queries.ts`, `dashboard/revenue`, `product-sales.ts`, `margin-query.ts`, `option-demand.ts`)이 이미 DelOrder 를 채널 무관하게 읽으므로 리더 코드 변경 0. 결제일(KST) 1일 = 1 `DelBatch(source=NAVER_API, COMPLETED)`, 동기화는 **일 단위 재구축**(그날 주문 삭제→재생성) 후 그날 옵션별 수량으로 `upsertOutboundMovement` delta 보정(쿠팡 로켓 패턴). 재고 truth 는 기존 위킵 엑셀 `threepl_current` 대조.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Vercel cron(`withCronRun`), `bcryptjs`(신규 — 커머스API 토큰 서명).

**Spec (확정 결정, 2026-10-25 grill):** memory `project_naver_nbaesong_sales_integration.md`
- 판매=커머스API, `deliveryAttributeType=ARRIVAL_GUARANTEE` **그리고** `logisticsCompanyId` 존재 행만. 판매자배송은 기존 Del 엑셀 경로 유지.
- 재고=위킵 엑셀 대조(기존). 위킵은 판매자배송·N배송 단일 풀 → **기존 3PL 위치 공유**(신규 위치 없음).
- 채널=별도 'N배송' 채널. 매칭=상품명 alias(기존 Del 방식).
- 결제일 기준. 출고 전 취소는 재조회로 제거. 반품은 판매로 유지(재입고는 대조가 보정).
- Vercel cron. 워크스페이스(Space)별 키 입력, N배송 시작일부터 백필.

## Global Constraints

- 스키마 변경은 `npx prisma migrate dev --name <작업명>` 만. `db push`·prod 직접 SQL 금지. shadow DB 깨지면 memory `reference_migrate_shadow_bypass` 절차.
- 자격증명은 기존 `SpaceCredential`(provider `'naver-commerce'`, `saveSpaceCredential`/`loadSpaceCredential`, field-crypto `'space-credential'`) 재사용. 신규 credential 테이블 금지.
- 자격증명 PUT 은 기존 `/api/spaces/[spaceId]/credentials/[provider]` 의 `requireSpaceAdmin` + `requireAal2` 관문 그대로.
- 수령인 PII 는 API 에서 **가져오지 않는다**. DelOrder 필수 PII 3필드는 `encryptOrderPii({recipientName:'N배송', phone:'-', address:'-'})` placeholder (docs/rules/03-security.md 최소수집).
- OUTBOUND referenceId 접두 `naver-nb:<YYYY-MM-DD>:<optionId>`. `delBatchId` 는 **설정하지 않는다**(묶음 삭제 cascade 가 재고 복원 없이 movement 를 지움).
- externalSource 값 `'naver_nbaesong'`, 라벨 `'스마트스토어 N배송'`, 채널명 `'스마트스토어 N배송'`.
- 일자는 전부 KST. `DelOrder.orderDate` = 결제일시(instant 그대로).
- 커밋 스타일: `✨ feat: ...` / `🐛 fix: ...` (한국어). 변경 파일 명시 스테이징(`git add -A` 금지).
- 검증: `npm run lint`, `npx tsc --noEmit`, 해당 jest, `npm run build`.

## Review Focus

1. **나중에 매칭한 미매칭 품목** — 사용자가 N배송 묶음 상세에서 품목을 매칭하면 그 날짜 OUTBOUND 가 즉시 재계산돼야 한다(7일 창 밖 과거 날짜 포함). → Task 6 테스트 `match on NAVER_API item recomputes that day`.
2. **동기화 후 취소** — 어제 수집된 주문이 오늘 CANCELED 가 되면 그날 재구축에서 빠지고 OUTBOUND 가 줄어야 한다. → Task 4 `canceled after sync restores stock`.
3. **한 주문 내 부분취소** — orderId 하나에 productOrder 2개 중 1개 취소면 DelOrder 는 남고 paymentAmount 는 살아있는 것만 합. → Task 4 `partial cancel keeps order with remaining amount`.
4. **KST 자정 경계** — 결제 `2026-10-24T23:59:00+09:00` 는 10-24 묶음, `T00:00:30+09:00` 는 10-25. → Task 2 `kstDay boundary`.
5. **옵션 INACTIVE/삭제** — `upsertOutboundMovement` 가 `'skipped'` 를 돌려도 동기화 전체가 실패하지 않는다. → Task 4 `inactive option does not abort day sync`.
6. **매칭이 다음 재구축에서 사라짐** — 매시 재구축이 DelOrderItem 을 지우므로 매칭은 N배송 채널 alias 로만 살아남는다. NAVER_API 품목은 alias 저장 강제. → Task 6 `match survives resync`.
7. **수집 실패일** — fetch 실패한 날은 기존 주문·OUTBOUND 그대로, 백필 커서는 그 날을 넘지 않는다. → Task 5 `fetch failure leaves day untouched`, `cursor stops at first failure`.

> ID 참조 확인(2026-10-25): DelOrder/DelOrderItem id 를 보관하는 건 `DelOrderItemFulfillment`(cascade)·`ChannelStockMovement`(MANUAL 배치 전용) 뿐 → 일 단위 delete-recreate 안전. `order-payment-alloc.ts` 는 순수 함수.

---

### Task 0: 커머스API 스파이크 (GATE — 실키 필요, 코드 커밋 없음)

사용자가 커머스API센터(apicenter.commerce.naver.com)에서 '직접 사용' 애플리케이션을 발급해야 시작 가능. 결과로 Task 2·4 의 필드명·엔드포인트를 확정한다. **아래 하나라도 계획과 다르면 멈추고 계획 수정.**

- [ ] **Step 1:** 공식 문서(apicenter.commerce.naver.com 문서, github.com/commerce-api-naver/commerce-api discussions)로 확인·기록:
  - 토큰: `POST https://api.commerce.naver.com/external/v1/oauth2/token`, form `client_id, timestamp(ms), client_secret_sign=base64(bcrypt(client_id+"_"+timestamp, client_secret)), grant_type=client_credentials, type=SELF`. 만료시간.
  - **호출 IP 등록 강제 여부.** 강제면 Vercel(동적 IP) 불가 → Task 5 를 워커(`worker/`)로 이전하는 계획 수정.
  - 결제일 범위 조회 API 존재 여부: `GET /external/v1/pay-order/seller/product-orders?from=&to=&rangeType=PAYED_DATETIME`(조건형 상품주문 조회). 최대 조회 구간·페이지네이션·rate limit. 없으면 `last-changed-statuses` + `product-orders/query` 조합으로 Task 2 `fetchPaidProductOrders` 설계 수정.
- [ ] **Step 2:** scratchpad 스크립트(`node`)로 실토큰 발급 + N배송 주문 있는 하루 조회. 응답 1건을 PII(이름·전화·주소·주문자 필드) **제거 후** `src/lib/naver-commerce/__tests__/fixtures/product-orders.json` 로 저장(일반배송 1건·N배송 1건·취소 1건 포함 목표).
- [ ] **Step 3:** fixture 로 확인: `productOrder.deliveryAttributeType` 실값(리브랜딩 후에도 `ARRIVAL_GUARANTEE`?), `productOrder.logisticsCompanyId` 존재, 필드명 `order.orderId`, `order.paymentDate`, `productOrder.productOrderId/productName/productOption/quantity/totalPaymentAmount/productOrderStatus`.
- [ ] **Step 4:** 별칭 키 정합 확인 — prod `DelColumnMappingPreset`(스마트스토어 채널)의 `productName` 매핑이 `[상품명, 옵션정보]` 순서 결합인지(파서 `get()` 은 `' '` join). 다르면 Task 2 `nbaesongItemName` 결합 규칙을 프리셋에 맞춘다.
- [ ] **Step 5:** 중복 확인(코드 아님) — 사용자에게 N배송 주문이 생긴 날의 스마트스토어 발주확인 엑셀에 N배송 주문이 섞이는지 확인 요청. 섞이면 별도 Task 로 Del 임포트 쪽 제외 필터 추가(API 쪽 가드는 도착 순서상 무의미).
- [ ] **Step 6:** 결과를 이 문서 Task 0 아래 "결과" 블록에 기록하고 커밋(`📝 docs: N배송 커머스API 스파이크 결과`).

---

### Task 1: 스키마·상수 — `NAVER_API` 소스와 N배송 외부 소스

**Files:**
- Modify: `prisma/schema.prisma` (`enum DelBatchSource` 에 `NAVER_API`)
- Create: `prisma/migrations/<ts>_del_batch_source_naver_api/migration.sql` (migrate dev 생성)
- Modify: `src/lib/inv/external-sources.ts`
- Test: `src/lib/inv/__tests__/external-sources.test.ts`

**Interfaces:**
- Produces: `EXTERNAL_SOURCE_NAVER_NBAESONG = 'naver_nbaesong'`, `EXTERNAL_SOURCES` 에 추가, `EXTERNAL_SOURCE_LABEL.naver_nbaesong = '스마트스토어 N배송'`; Prisma `DelBatchSource.NAVER_API`.

- [ ] **Step 1: 실패 테스트** — `isExternalSource('naver_nbaesong') === true`, `EXTERNAL_SOURCE_LABEL.naver_nbaesong === '스마트스토어 N배송'`.
- [ ] **Step 2:** `npx jest src/lib/inv/__tests__/external-sources.test.ts` → FAIL.
- [ ] **Step 3:** 상수 추가 + enum 값 추가 후 `npx prisma migrate dev --name del_batch_source_naver_api`.
- [ ] **Step 4:** jest PASS, `npx tsc --noEmit` 통과(`Record<ExternalSource,…>` 누락 지점이 있으면 여기서 드러남 — 라벨 추가로 해결).
- [ ] **Step 5:** 커밋 `✨ feat: N배송 외부 소스·NAVER_API 배치 소스 추가`.

---

### Task 2: 커머스API 클라이언트·N배송 판별

**Files:**
- Create: `src/lib/naver-commerce/client.ts`
- Create: `src/lib/naver-commerce/nbaesong.ts`
- Test: `src/lib/naver-commerce/__tests__/client.test.ts`, `src/lib/naver-commerce/__tests__/nbaesong.test.ts`
- Modify: `package.json` (`bcryptjs` + `@types/bcryptjs` 필요 시)

**Interfaces:**
- Produces:
  - `export const NAVER_COMMERCE_PROVIDER = 'naver-commerce'`
  - `export type NaverCommerceSecret = { clientId: string; clientSecret: string }`
  - `export type NaverCommerceConfig = { startDate: string /* YYYY-MM-DD */; locationId: string; representativeChannelId?: string | null; backfilledThrough?: string | null }`
  - `export function signClientSecret(clientId: string, clientSecret: string, timestampMs: number): string`
  - `export async function issueToken(secret: NaverCommerceSecret): Promise<string>`
  - `export type NaverProductOrder = { orderId: string; productOrderId: string; paymentDate: string; productName: string; productOption: string | null; quantity: number; totalPaymentAmount: number; productOrderStatus: string; deliveryAttributeType: string | null; logisticsCompanyId: string | null }` (Task 0 fixture 필드명으로 매핑)
  - `export async function fetchPaidProductOrders(token: string, dayKst: string): Promise<NaverProductOrder[]>` — 그날 KST 00:00~24:00 결제분 전체(페이지 끝까지, 현재 상태 포함)
  - (`nbaesong.ts`) `export function isNbaesong(po: NaverProductOrder): boolean`, `export const EXCLUDED_STATUSES: ReadonlySet<string> = new Set(['CANCELED','CANCELED_BY_NOPAYMENT','PAYMENT_WAITING'])`, `export function kstDay(iso: string): string`, `export function nbaesongItemName(po: NaverProductOrder): string`

- [ ] **Step 1: 실패 테스트 (`client.test.ts`)**
  - `signClientSecret` 결과를 base64 디코드 → `bcrypt.compareSync(\`${id}_${ts}\`, decoded) === true` (salt 는 테스트용 `bcrypt.genSaltSync(4)` 를 clientSecret 으로).
  - `fetchPaidProductOrders` — `global.fetch` mock 으로 fixture 반환 시 `NaverProductOrder[]` 매핑, 다음 페이지 존재 시 2회 호출.
- [ ] **Step 2: 실패 테스트 (`nbaesong.test.ts`)**
  - `isNbaesong` : fixture N배송 건 true, 일반배송 false, `ARRIVAL_GUARANTEE`인데 `logisticsCompanyId` null → false.
  - `kstDay boundary`: `kstDay('2026-10-24T23:59:00+09:00') === '2026-10-24'`, `kstDay('2026-10-25T00:00:30+09:00') === '2026-10-25'`, `kstDay('2026-10-24T15:00:30Z') === '2026-10-25'`.
  - `nbaesongItemName({productName:'A', productOption:'색상: 블랙'}) === 'A 색상: 블랙'`, 옵션 null → `'A'` (Task 0 Step 4 결과로 규칙 확정).
- [ ] **Step 3:** 두 jest FAIL 확인.
- [ ] **Step 4:** 구현. `npm i bcryptjs`. 토큰은 호출당 신규 발급(캐시 없음 — cron 1회 1토큰). HTTP 오류는 `Error(\`naver-commerce ${status}: ${maskSecrets(body)}\`)`.
- [ ] **Step 5:** jest PASS.
- [ ] **Step 6:** 커밋 `✨ feat: 네이버 커머스API 클라이언트·N배송 판별`.

---

### Task 3: 주문 품목 alias 해석 추출 (배송 임포트 리팩터)

**Files:**
- Create: `src/lib/del/resolve-order-items.ts`
- Modify: `app/api/sh/shipping/import/route.ts:125-262` (인라인 aliasLookup/listingItemsMap/items 구성 → 새 함수 호출)
- Test: `src/lib/del/__tests__/resolve-order-items.test.ts`

**Interfaces:**
- Produces:
  - `export type ResolvedItem = { name: string; quantity: number; optionId: string | null; listingId: string | null; fulfillments: Array<{ optionId: string; quantity: number }> }`
  - `export async function loadItemResolver(spaceId: string, channelIds: string[], rawNames: string[]): Promise<(rawName: string, qty: number) => ResolvedItem>` — `channelIds` 앞쪽 채널 alias 우선, 없으면 다음 채널(대표 채널 폴백). 우선순위 fulfillments > listing > option 은 기존 `buildAliasLookup` 그대로.

- [ ] **Step 1: 실패 테스트** (prisma mock, 기존 `app/api/sh/shipping/import` 테스트 mock 스타일)
  - fulfillments alias → `quantity = f.quantity * qty`.
  - listing alias → listing items × qty 팬아웃.
  - 첫 채널에 없고 두 번째 채널에 있는 이름 → 두 번째 채널 target 사용.
  - 둘 다 없으면 optionId/listingId null, fulfillments [].
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현 후 import route 를 `loadItemResolver(space.id, channelId ? [channelId] : [], names)` 로 교체(동작 동일).
- [ ] **Step 4:** 새 테스트 + 기존 shipping import 테스트(`npx jest app/api/sh/shipping`) PASS.
- [ ] **Step 5:** 커밋 `♻️ refactor: 배송 주문 품목 alias 해석 공용화`.

---

### Task 4: N배송 일 단위 동기화 코어

**Files:**
- Create: `src/lib/naver-commerce/nbaesong-sync.ts`
- Create: `src/lib/naver-commerce/nbaesong-channel.ts`
- Test: `src/lib/naver-commerce/__tests__/nbaesong-sync.e2e.test.ts` (memory `reference_prisma7_jest_integration`, `jest.config.e2e.ts`, `--runInBand`)

**Interfaces:**
- Consumes: Task 1 상수, Task 2 `NaverProductOrder`/`isNbaesong`/`EXCLUDED_STATUSES`/`kstDay`/`nbaesongItemName`, Task 3 `loadItemResolver`, 기존 `upsertOutboundMovement` (`src/lib/inv/coupang-sales-to-movement.ts:231`), `encryptOrderPii`.
- Produces:
  - `export async function ensureNbaesongChannel(spaceId: string, representativeChannelId: string | null): Promise<string>` — `ensureCoupangSalesChannel` 과 같은 규칙(externalSource 로 조회 → 동명 채널 승격 → 생성), `representativeChannelId` 갱신.
  - `export function nbaesongReferenceId(dayKst: string, optionId: string): string` → `naver-nb:${dayKst}:${optionId}`
  - `export async function syncNbaesongDay(p: { spaceId: string; channelId: string; locationId: string; representativeChannelId: string | null; dayKst: string; orders: NaverProductOrder[] }): Promise<{ orders: number; items: number; unmatched: number; outbound: { created: number; updated: number; skipped: number } }>`
  - `export async function recomputeNbaesongOutbound(spaceId: string, channelId: string, locationId: string, dayKst: string): Promise<{ created: number; updated: number; skipped: number }>`

동작(`syncNbaesongDay`): 입력 중 `isNbaesong && kstDay(paymentDate)===dayKst && !EXCLUDED_STATUSES.has(status)` 만 사용 → `DelBatch` 를 `(spaceId, source:'NAVER_API', label:\`N배송 ${dayKst}\`)` 로 findFirst/create(`status:'COMPLETED'`, `completedAt`) → **한 `$transaction` 안에서** 그 배치의 DelOrder 전부 삭제(cascade) → `orderId` 로 그룹해 DelOrder 생성(`orderNumber=orderId`, `orderDate=new Date(min paymentDate)`, `paymentAmount=Σ totalPaymentAmount`, placeholder PII, `channelId`), 품목은 `loadItemResolver(spaceId, [channelId, representativeChannelId].filter(Boolean), names)`. 남은 주문 0이면 배치도 삭제. 마지막에 `recomputeNbaesongOutbound`.

동작(`recomputeNbaesongOutbound`): 그날 배치 품목을 옵션별 합산(fulfillments 있으면 그것, 없으면 optionId×quantity) → 각 옵션 `upsertOutboundMovement({…, quantity, movementDate: new Date(\`${dayKst}T00:00:00+09:00\`), referenceId})`; 기존 `referenceId startsWith naver-nb:${dayKst}:` 인데 이번 합산에 없는 옵션은 `quantity: 0` 으로 호출(복원).

- [ ] **Step 1: 실패 테스트** (dev DB, 테스트 Space·옵션·위치 시드, afterAll 정리)
  - `first sync creates batch, orders, OUTBOUND` — N배송 2건(옵션 A 2개, B 1개) + 일반배송 1건 → DelOrder 2, OUTBOUND A=2, B=1, 위치 재고 −3, 일반배송 미적재.
  - `resync is idempotent` — 같은 입력 재호출 → OUTBOUND skipped, 재고 변화 0, DelOrder 수 동일.
  - `canceled after sync restores stock` — 두 번째 호출에서 A 주문 CANCELED → OUTBOUND A 삭제, 재고 +2.
  - `partial cancel keeps order with remaining amount` — orderId 1개에 productOrder 2개(10000, 5000) 중 5000 취소 → DelOrder 1, paymentAmount 10000.
  - `inactive option does not abort day sync` — 옵션 B 의 상품 INACTIVE → 결과 outbound.skipped ≥ 1, 함수 정상 반환.
  - `representative alias fallback` — alias 가 대표 채널에만 있어도 매칭됨.
- [ ] **Step 2:** `npx jest -c jest.config.e2e.ts src/lib/naver-commerce/__tests__/nbaesong-sync.e2e.test.ts --runInBand` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `✨ feat: N배송 일 단위 주문 적재·재고 차감`.

---

### Task 5: 자격증명 provider + cron (최근 7일 재동기화 + 백필 청크)

**Files:**
- Modify: `app/api/spaces/[spaceId]/credentials/[provider]/route.ts` (`SCHEMAS['naver-commerce']`, 검증 분기)
- Create: `app/api/cron/naver-nbaesong-sync/route.ts`
- Create: `src/lib/naver-commerce/nbaesong-runner.ts`
- Modify: `vercel.json` (`crons` + `functions.maxDuration: 300`)
- Test: `app/api/spaces/[spaceId]/credentials/[provider]/__tests__/route.test.ts` (케이스 추가), `src/lib/naver-commerce/__tests__/nbaesong-runner.test.ts`

**Interfaces:**
- Consumes: Task 2 `issueToken`/`fetchPaidProductOrders`/타입, Task 4 `ensureNbaesongChannel`/`syncNbaesongDay`, 기존 `saveSpaceCredential`/`loadSpaceCredential`/`recordCredentialError`, `withCronRun`.
- Produces:
  - `export function daysToSync(today: string, config: NaverCommerceConfig, backfillChunk = 7): string[]` — 어제부터 거꾸로 7일(단 `>= startDate`) ∪ `backfilledThrough`(없으면 `startDate`−1일) 다음날부터 최대 `backfillChunk` 일(어제−7 이전까지). 오래된 날 먼저 정렬, 중복 제거.
  - `export function advanceCursor(prev: string | null, backfillDays: string[], ok: Set<string>): string | null` — 기존 커서 다음날부터 **연속 성공한 마지막 날**까지만 전진(첫 실패에서 멈춤).
  - `export async function runNbaesongSyncForSpace(spaceId: string, today: string): Promise<{ days: string[]; failed: string[]; error?: string }>` — 토큰 1회, 날마다 fetch→sync. **fetch 가 throw 하면 그 날은 `syncNbaesongDay` 를 호출하지 않는다**(기존 데이터 보존). `advanceCursor` 결과로 config `backfilledThrough` 갱신(`saveSpaceCredential` 대신 config 만 update — secret 재암호화 불필요하면 `prisma.spaceCredential.update({ data:{ config } })`). 실패 시 `recordCredentialError`.
  - zod: `secret: { clientId: string.min(10), clientSecret: string.min(10) }`, `config: { startDate: /^\d{4}-\d{2}-\d{2}$/, locationId: string.min(1), representativeChannelId?: string|null }`. 검증: `issueToken` 성공 + `invStorageLocation` 이 해당 space 소유. 통과 시 `ensureNbaesongChannel` 호출.

- [ ] **Step 1: 실패 테스트**
  - `daysToSync('2026-10-25', {startDate:'2026-10-01', …})` → `['2026-10-01'..'2026-10-07']` ∪ `['2026-10-18'..'2026-10-24']` (14개, 오름차순).
  - `backfilledThrough:'2026-10-17'` → 최근 7일만.
  - `startDate:'2026-10-22'` → `['2026-10-22','2026-10-23','2026-10-24']`.
  - `cursor stops at first failure` — `advanceCursor('2026-09-30', ['10-01','10-02','10-03'], ok={10-01,10-03})` → `'2026-10-01'`; 전부 실패 → `'2026-09-30'`.
  - `fetch failure leaves day untouched` — `fetchPaidProductOrders` mock 이 특정 날 throw → 그 날 `syncNbaesongDay` 미호출, `failed` 에 포함, 다른 날은 진행.
  - credentials route: naver-commerce 정상 → 200 + `ensureNbaesongChannel` 호출, 남의 space locationId → 400, 토큰 실패 → 400 (기존 테스트 mock 방식 그대로).
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. cron 은 `withCronRun('/api/cron/naver-nbaesong-sync', …)` 로 provider `'naver-commerce'` SpaceCredential 전체 순회(space 별 try/catch, 한 space 실패가 다른 space 를 막지 않음). schedule `"0 * * * *"`(매시 — 백필 청크 진행 + 당일 취소 반영). Task 0 에서 rate limit 이 빡빡하면 `backfillChunk` 축소.
- [ ] **Step 4:** PASS + `npx tsc --noEmit`.
- [ ] **Step 5:** 커밋 `✨ feat: N배송 커머스API 자격증명·수집 cron`.

---

### Task 6: 배송 화면 가드·매칭 후 재계산·연동 설정 UI

**Files:**
- Modify: `app/api/sh/shipping/batches/[batchId]/route.ts` (PATCH status·DELETE: `source==='NAVER_API'` → 400 `'N배송 자동 수집 묶음은 변경할 수 없습니다'`)
- Modify: `app/api/sh/shipping/orders/[orderId]/items/[itemId]/match/route.ts` (주문의 batch.source 가 NAVER_API 면 ① `saveAlias` 를 무조건 true 로(alias 가 매시 재구축에서 매칭을 살리는 유일한 수단), `mode:'clear'` 는 400 ② 반영 후 `recomputeNbaesongOutbound(space, order.channelId, cred.config.locationId, kstDay(order.orderDate))`). `product-match-dialog.tsx` 는 N배송 품목이면 'alias 저장' 토글 숨김.
- Modify: `app/api/sh/shipping/orders/[orderId]/route.ts`(수정·삭제), `orders/[orderId]/items/[itemId]/route.ts`, `orders/[orderId]/clone/route.ts` — 주문의 batch.source 가 NAVER_API 면 400 `'N배송 자동 수집 주문은 변경할 수 없습니다'`.
- 연동 카드: 첫 동기화 이후(`backfilledThrough` 존재) 출고 위치 Select 비활성 + "위치 변경은 재고 대조 후 재등록 필요" 안내 (`upsertOutboundMovement` 는 위치 변경 시 구 위치를 복원하지 않음).
- Modify: 배송 묶음 목록 컴포넌트(`source` 표시 지점, `grep -rn "source" src/components/sh/shipping`) — `NAVER_API` 배지 `'N배송 자동'`, 완료/삭제/파일생성 버튼 숨김
- Create: `src/components/sh/settings/naver-commerce-card.tsx` + seller-ops 연동 설정 페이지에 배치(`IntegrationCatalog` 옆; 쿠팡 크레덴셜 카드 위치 따라감). 입력: clientId, clientSecret, N배송 시작일(`<input type="date">`), 출고 위치(Select: space 위치 목록), 대표 채널(Select, 기본 '스마트스토어' 이름 일치 채널). PUT `/api/spaces/${spaceId}/credentials/naver-commerce`. MFA 미인증 응답 시 기존 MFA 안내 그대로.
- Test: `app/api/sh/shipping/batches/__tests__/` 에 NAVER_API PATCH/DELETE 400, 주문 수정·품목 수정·복제 NAVER_API 400, match route 테스트에 `match on NAVER_API item recomputes that day`(recompute mock 인자 검증) + `saveAlias:false 여도 alias 저장`. Task 4 e2e 파일에 `match survives resync` — 품목 미매칭으로 sync → alias 생성(매칭 라우트와 동일 데이터) → 같은 입력 재 sync → 품목 매칭 유지·OUTBOUND 생성.

**Interfaces:**
- Consumes: Task 4 `recomputeNbaesongOutbound`, Task 2 `kstDay`/`NAVER_COMMERCE_PROVIDER`/`NaverCommerceConfig`, `loadSpaceCredentialConfig`.

- [ ] **Step 1:** 실패 테스트 작성 → FAIL 확인.
- [ ] **Step 2:** 구현.
- [ ] **Step 3:** jest PASS, `npm run lint`, `npm run build`.
- [ ] **Step 4:** 로컬 dev 에서 연동 카드 렌더·배송 목록 N배송 배지 확인(memory `reference_local_dev_qa_login`), 스크린샷.
- [ ] **Step 5:** 커밋 `✨ feat: N배송 묶음 읽기전용·매칭 후 재고 재계산·연동 설정 카드`.

---

### Task 7: preview 실키 검증·릴리스

- [ ] **Step 1:** develop PR(→ preview). preview 에서 실키 등록 → `curl -H "Authorization: Bearer $CRON_SECRET" <preview>/api/cron/naver-nbaesong-sync` 1회.
- [ ] **Step 2:** 대조 확인: 하루 골라 스마트스토어센터 N배송 주문 수·금액 = 그날 `DelOrder`(N배송 채널) 수·`paymentAmount` 합. 판매분석 채널 탭에 '스마트스토어 N배송' 표시. 위킵 위치 OUTBOUND 합 = 품목 fulfillment 합.
- [ ] **Step 3:** 미매칭 품목 1건을 배송 묶음 상세에서 매칭 → 해당일 OUTBOUND 증가 확인.
- [ ] **Step 4:** memory `feedback_worktree_release_flow` 대로 develop → main 단계 릴리스. 배포 후 위킵 엑셀 대조 1회로 baseline 리셋 안내.
- [ ] **Step 5:** memory `project_naver_nbaesong_sales_integration.md` 상태 갱신.
