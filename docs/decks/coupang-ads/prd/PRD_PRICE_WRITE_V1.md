# PRD — 쿠팡 Open API 가격 쓰기 (v1)

**작성** 2026-09-11 · **Deck** coupang-ads (진입점은 seller-hub 가격시뮬) · **상태** 설계 승인 대기

## 1. 배경

쿠팡 Open API를 **읽기(수집) 소스**로 붙이는 작업은 2026-09-11 종결됐다. 5개 스코프 중 4개(광고·재고·판매·정산)가 로켓그로스 미커버 또는 컬럼 결손으로 잠겼고, 상품 스코프만 열려 있다. 상세는 메모리 `project_coupang_open_api_source.md`.

남은 미탐색 영역은 **쓰기 API(~55개)** 다. 읽기는 크롤링이 더 풍부했지만, 쓰기는 비교 대상이 없다 — 크롤링으로 가격을 바꾸려면 Wing DOM 자동화가 되고 이는 Akamai 차단·화면 변경에 그대로 노출된다(이 프로젝트가 반복 실패한 유형). API 쓰기는 공식 계약이고 실패가 코드로 온다.

### 읽기를 죽인 병목이 쓰기에는 없다

읽기 4개 스코프를 잠근 원인은 "로켓그로스 미커버"였다. 쓰기는 반대다 — 공식 문서상 **로켓그로스/하이브리드 상품의 판매가·재고·판매상태·할인율기준가는 상품수정 API가 아니라 옵션별(`vendorItemId`) 변경 API로만 변경 가능**하다. RG `vendorItemId`가 정규 경로다.

> 출처: [상품 수정 (로켓그로스 또는 마켓플레이스/로켓그로스 동시 운영 상품)](https://developers.coupang.com/hc/ko/articles/39407792403609-%EC%83%81%ED%92%88-%EC%88%98%EC%A0%95-%EB%A1%9C%EC%BC%93%EA%B7%B8%EB%A1%9C%EC%8A%A4-%EB%98%90%EB%8A%94-%EB%A7%88%EC%BC%93%ED%94%8C%EB%A0%88%EC%9D%B4%EC%8A%A4-%EB%A1%9C%EC%BC%93%EA%B7%B8%EB%A1%9C%EC%8A%A4-%EB%8F%99%EC%8B%9C-%EC%9A%B4%EC%98%81-%EC%83%81%ED%92%88) · [상품 아이템별 가격 변경](https://developers.coupang.com/ko/api/products/changing-price-of-each-item-of-a-product)

## 2. 목표

가격시뮬레이션에서 산출한 판매가를 **승인 큐를 거쳐 쿠팡 실판매가에 반영**한다. 지금은 사람이 Wing에서 손으로 옮긴다.

**v1 범위는 액션 1개다.** 이 레포는 읽기에서 5개 스코프를 짓고 4개를 잠근 이력이 있다. 가격 하나를 끝까지 관통시키고, 판매중지/재개·쿠폰은 검증된 레일 위에 `ActionDefinition` 추가로 축소한다.

### 비목표 (v1)

- 판매중지/재개, 수량 변경, 쿠폰 발행 — v2 이후
- 마켓플레이스 축 가격 쓰기 — 수집·매핑은 하되 쓰기는 RG만
- 조건부 자동 실행 — §7 참조
- 물류·배송·반품 쓰기 계열 — RG 중심 운영이라 효용 낮음

## 3. 사용자 흐름

```
가격시뮬 화면
  → [쿠팡에 반영] 버튼
    → PRICE_REFRESH 잡 생성 → 워커가 대상 옵션 현재가만 조회(1.3초) → 스냅샷 갱신
      → 대상 옵션 미리보기 (현재가 → 목표가, Δ%, 경고)
        → 승인 큐에 PENDING 액션 생성
          → 관리자 승인 (승인 상세 시트)
            → CoupangWriteJob PENDING 행 생성
              → 워커 폴링(30초) → 현재가 재조회 → 대조 → PUT → 응답 body 검증
                → 결과 기록 + 스냅샷 갱신 + Slack 알림
```

### 미리보기 전 갱신이 필요한 이유

`CoupangProductItem` 수집은 주 1회다. 그 스냅샷의 값을 `expectedCurrentPrice` 로 쓰면 **사람은 최대 일주일 묵은 숫자를 보고 승인하고, 그 사이 가격이 움직였으면 워커가 전부 중단**시킨다. 신선도 가드와 수집 주기가 조용히 묶여 있어선 안 된다.

- **미리보기 진입 시 대상 옵션만 단건 갱신**한다. 전체 순회 70초가 아니라 옵션 1건 1.3초다. `CoupangWriteJob` 에 `kind: PRICE_REFRESH` 를 추가해 같은 폴링 레일을 쓴다(새 인프라 없음). 화면은 잡 완료를 폴링한다.
- **쓰기 성공 후 워커가 `CoupangProductItem.salePrice` 를 즉시 갱신**한다. 이게 없으면 §11 검증 4번(변경 후 원복)의 원복이 방금 무효화된 스냅샷을 상대로 제출돼 **반드시 ABORT** 된다 — 명세대로면 인수 테스트가 통과할 수 없다.

## 4. 가격 매핑 규칙 (결정 사항)

시뮬에는 가격이 4겹이고 쿠팡에는 2개다.

```
시뮬:  salePrice → ×(1 - discountRate) → 프로모션 적용 → finalPrice
쿠팡:  PUT .../prices/{price}            (판매가)
       PUT .../original-prices/{price}   (할인율 기준가)
```

**결정: `salePrice`(할인·프로모션 적용 전)만 쿠팡 판매가(`prices`)로 민다.**

- `original-prices`는 v1에서 건드리지 않는다.
- `discountRate`·프로모션은 반영하지 않는다. 쿠팡 쪽 할인은 쿠팡 도구로 별도 운영한다.
- `PromotionType.COUPON`은 판매가 인하가 아니라 쿠폰 발행이므로 `finalPrice`를 판매가로 밀면 이중 할인이 실제로 걸린다. 이 결정은 그 위험을 구조적으로 제거한다.
- **미리보기에 명시**한다: "이 시나리오에는 할인 N% / 프로모션 X가 있으나 쿠팡 판매가에는 반영되지 않습니다." 조용한 차이를 만들지 않는다.

### VAT 기준

`pricing-calc.ts:99` 기준 `includeVat=true`(기본값)이면 `salePrice`는 **VAT 포함 실결제가**다(메모리 `project_pricing_sim_margin_gross_base`의 gross 전환 결과). 쿠팡 판매가도 VAT 포함 소비자가이므로 기준이 일치한다.

**가드**: `includeVat=false` 시나리오는 `salePrice`가 ex-VAT라 그대로 밀면 10% 낮게 반영된다. → **쓰기 차단**하고 사유를 표시한다. (자동 gross-up 하지 않는다 — 의도를 추측하지 않는다.)

## 5. 데이터

### 5.1 내부 옵션 → `vendorItemId`

**RG축 다리는 이미 있다.** `src/lib/sh/external-option-bridge.ts` 의 3-hop 이 쿠팡 외부 optionId(= RG `vendorItemId`) ↔ `InvProductOption` 을 잇는다. 새로 만들지 않는다.

```
외부 optionId
  → INVENTORY_HEALTH InventoryRecord (optionId·skuId 동시 보유)
    → InvLocationProductMap.externalCode = skuId
      → InvLocationProductMapItem (optionId, quantity)
        → InvProductOption
```

**가드**: 이 브리지는 1:N 팬아웃(세트)을 허용한다. 내부 옵션 하나가 외부 optionId 하나로 **1:1** 로 떨어지지 않으면 어느 옵션의 가격인지 불명이므로 **쓰기 대상에서 제외**하고 사유를 표시한다.

### 5.2 신규 모델 `CoupangProductItem`

앱(Vercel)은 쿠팡 API를 호출할 수 없다(IP allowlist). 미리보기에 현재 판매가가 필요하므로 스냅샷을 적재한다.

| 필드              | 설명                                                     |
| ----------------- | -------------------------------------------------------- |
| `spaceId`         | 워크스페이스 스코프                                      |
| `sellerProductId` | 상품 API 등록상품 ID                                     |
| `vendorItemId`    | 옵션 ID — **쓰기 타깃**                                  |
| `axis`            | `ROCKET_GROWTH` \| `MARKETPLACE`                         |
| `itemName`        | 옵션명                                                   |
| `salePrice`       | 수집 시점 판매가                                         |
| `statusName`      | 승인완료/임시저장 등                                     |
| `barcode`         | 실물 식별자 (입고 검수용, v1은 적재만)                   |
| `skuInfo`         | Json — 치수·무게·`quantityPerBox`·유통기한 (v1은 적재만) |
| `collectedAt`     | 수집 시각 — 신선도 판정                                  |

`@@unique([spaceId, vendorItemId])`

**수집**: 기존 `worker/src/coupang-api/product-map.ts` 의 목록→단건 순회를 재사용한다(상품 55개 × 1.3초 스로틀 ≈ 70초). 주 1회 + 수동 트리거.

**`CoupangSourceSetting` 에 넣지 않는다.** 저 모델은 CRAWL/API **소스 전환** 토글이고, 상품 API는 크롤링을 대체하지 않는 **보강 데이터**다. 개념이 다르다. 그리고 그 토글로 지은 5개 중 4개가 잠겼다 — 같은 실수를 이름만 바꿔 반복하지 않는다.

⚠️ **RG `vendorItemId`는 중첩**이다: `items[].rocketGrowthItemData.vendorItemId`. 평면으로 읽으면 타입 에러 없이 0건이 되고 증상만 나타난다(§9 유형).

### 5.3 신규 모델 `CoupangWriteJob`

| 필드               | 설명                                                           |
| ------------------ | -------------------------------------------------------------- |
| `workspaceId`      | 워커 폴링 스코프                                               |
| `actionId`         | `AgentPendingAction.id` — `@unique` (멱등)                     |
| `kind`             | `PRICE_CHANGE` \| `PRICE_REFRESH`                              |
| `payload`          | Json — vendorItemId, targetPrice, expectedCurrentPrice, force  |
| `status`           | `PENDING` \| `RUNNING` \| `SUCCEEDED` \| `FAILED` \| `ABORTED` |
| `attempts`         | 재시도 횟수                                                    |
| `observedPrice`    | 워커가 PUT 직전 읽은 실제 현재가                               |
| `result` / `error` | 쿠팡 응답 / 실패 사유                                          |
| `executedAt`       |                                                                |

### 5.4 Space 축과 Workspace 축

두 축이 섞여 있다. `ActionExecContext` 는 `{ spaceId, requestedBy }` 만 갖고 workspaceId 가 없는데, 워커 폴링과 옵션 브리지는 workspaceId 를 요구한다. **이 축 혼동은 이 기능에서 이미 버그로 나갔다** — `54b2f882 fix(coupang-ads): API 자격 저장·연결 테스트 실패 (워크스페이스 축 + 응답 래퍼)`.

- 정식 해석 경로는 **`resolveCoupangWorkspaceForSpace(spaceId)`** 다(`src/lib/sh/margin-query.ts:229` 에서 `loadExternalOptionBridge(spaceId, coupang.workspaceId)` 호출에 쓰는 것과 동일).
- **nullable 이다.** 쿠팡 워크스페이스가 연결돼 있지 않으면 액션 생성 자체를 거부한다(승인 후 워커에서 터지게 두지 않는다).
- `execute()` 는 이 함수로 workspaceId 를 해석해 `CoupangWriteJob.workspaceId` 에 넣는다.
- `CoupangProductItem` 은 `spaceId` 축으로 둔다(미리보기가 앱 쪽 Space 스코프에서 읽는다). 워커는 job 의 workspaceId 로 자격을 찾고, 적재 시 spaceId 로 되돌린다.

## 6. 실행 경로

### 6.1 승인 큐는 기존 것을 그대로 쓴다

`AgentPendingAction` + `ActionDefinition`(`src/lib/agent/actions/`)에 이미 있다: `payload`, `summary`, `beforeState`(롤백 참고), `idempotencyKey`, 72h 만료, `requiredRole` 게이트, Slack 알림(`src/lib/slack/notify-pending-action.ts`), 승인 UI(`src/components/approvals/`). **새로 만들 안전장치가 거의 없다.**

```ts
actionType:   'coupang-ads.price.change'
deckKey:      'coupang-ads'
requiredRole: 'ADMIN'
params: {
  optionId: string            // 내부 InvProductOption.id
  vendorItemId: string        // 쿠팡 옵션 ID (RG축)
  targetPrice: number
  expectedCurrentPrice: number // 미리보기에 표시된 현재가
  force?: boolean             // forceSalePriceUpdate
  scenarioId?: string         // 출처 추적
}
```

### 6.2 `execute()` 는 쿠팡을 직접 부르지 않는다

쿠팡 API는 allowlist 등록 IP(워커, 현재 `112.152.74.59`)에서만 호출된다. `execute()` 는 Vercel에서 돈다. 따라서 `execute()` 는 **`CoupangWriteJob` PENDING 행을 만들고 끝낸다.** 워커가 30초 폴링해 실제 PUT을 수행한다 — `worker/src/manual-poller.ts` 패턴 그대로.

### 6.3 워커 `price-writer.ts`

```
1. PENDING job 1건 claim (RUNNING 전이)
2. 아이템별 수량/가격/상태 조회 API 로 현재가 재조회
3. expectedCurrentPrice 와 대조
   ├─ 현재가 == targetPrice → SUCCEEDED (멱등 no-op). PUT 안 함
   ├─ 현재가 != expectedCurrentPrice → ABORTED. "미리보기 이후 가격이 변경됨(현재 X원)"
   └─ 일치 → observedPrice 기록 후 진행
4. PUT /v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/prices/{price}
5. 응답 body 검증 (§8)
6. SUCCEEDED/FAILED 기록 → CoupangProductItem.salePrice 갱신 → Slack 알림
```

**3번의 첫 분기가 크래시 복구다.** 잡이 RUNNING 이고 PUT은 성공했는데 기록 직전에 워커가 죽으면, 재시도 시 현재가가 이미 `targetPrice` 다. 이때 `expectedCurrentPrice` 와만 비교하면 ABORT 로 보고된다 — **쓰기는 일어났는데 안 일어났다고 보고**하는 상태다. 현재가 ∉ {expected, target} 일 때만 중단한다.

⚠️ **2번 조회 엔드포인트는 아직 없다.** `endpoints.ts` 의 래퍼 8종에 "상품 아이템별 수량/가격/상태 조회"가 없다. 신규 래퍼 + 자체 픽스처 파싱 테스트가 필요하다(§11).

**3번이 핵심이다.** `snapshot()` 은 앱에서 **생성 시점**에 찍히는데 PUT은 나중에 워커에서 실행된다. 그 사이 가격이 바뀌면 `beforeState` 가 낡고 롤백이 엉뚱한 값을 복원한다. 이는 재고 대조의 `matchResults.systemQuantity` 스냅샷 함정(차이 합계 −1,400 허수)과 **같은 버그 유형**이다. 워커가 PUT 직전 실제 값을 읽어 기록하고, 어긋나면 중단한다.

### 6.4 롤백

별도 롤백 기계를 만들지 않는다. 롤백 = `observedPrice` 를 목표가로 하는 **새 액션 생성**. 승인 흐름·감사 기록이 동일하게 적용된다.

## 7. 자동화 — v1에서는 넣지 않는다

기획 단계에서 "조건부 자동 실행 + 사후 알림"을 선택했다. 다만 **v1 범위에 있는 유일한 액션이 가격**이고, 가격 자동 실행은 위험하다(시뮬 오출력이 곧바로 실판매가가 된다).

**결정: 자동승인 레일은 v2(판매중지/재개)에서 도입한다.** 조건이 기계적으로 명확한 첫 케이스가 "재고 0 → 판매중지"다. 가격은 그 이후에도 사람 승인을 유지한다.

### 도입 시 구조 (v2 예고 — v1에서 구현하지 않음)

기존 큐 계약은 `src/lib/agent/actions/types.ts:21` 에 이렇게 적혀 있다:

> `execute는 승인(APPROVED 전이 성공) 이후에만 호출된다. 절대 즉시 mutate 금지.`

자동 실행은 이 불변식과 충돌한다. 두 갈래 중 **A를 채택한다**:

- **A (채택)** 자동 액션도 큐에 넣되 `source: 'SYSTEM'` 으로 만들고 **자동 APPROVED 전이** 후 실행 → 사후 알림. 감사 기록·`beforeState`·멱등키·Slack이 전부 유지되고 실행 경로가 하나로 남는다. 대가: "절대 즉시 mutate 금지"가 전역 불변식에서 **actionType별 정책**으로 바뀐다. 자동승인 허용 actionType을 화이트리스트로 못박고, 계약 주석을 함께 수정한다.
- **B (기각)** 자동은 큐를 우회. 불변식은 지키지만 쓰기 경로가 둘로 갈리고, **무인으로 도는 쪽에 감사 기록과 롤백 스냅샷이 없다.**

## 8. 응답 파싱 — HTTP 200 은 성공이 아니다

```json
{ "code": "200", "message": "", "data": { "code": "SUCCESS", "message": "", "data": 427011919 } }
```

성공 판정은 **중첩된 `data.code === "SUCCESS"`** 다. HTTP 200을 성공으로 읽으면 "가격이 반영됐다"고 보고하고 실제로는 안 바뀐다.

`client.ts` 는 현재 **GET 전용**이다. `put<T>()` 을 추가한다 — CEA 서명 message 는 `signedDate + method + path + query` 로 **body를 포함하지 않으므로** 서명 로직은 그대로다. 스로틀·429 백오프·IP 거부 분류도 재사용한다.

단 `forceSalePriceUpdate` 는 **쿼리 파라미터**다. 즉 `buildQueryString()` 을 거쳐 **서명 message 에 들어간다.** 서명에 쓴 query 문자열과 실제 요청 URL 의 순서가 어긋나면 서명 불일치로 실패한다(`signature.ts` 주석의 정렬 안 함 규약). `get()` 과 같은 방식으로 한 번만 만들어 양쪽에 쓴다.

## 9. 이 기능의 알려진 실패 유형

읽기 구축에서 나온 무음 실패 5건은 **전부 같은 유형**이었다 — 타입이 실물과 달라 타입 에러 없이 조용히 `undefined` 가 되고 증상만 나타남.

1. UI가 `{credential}`/`{setting}`/`{run}` 응답 래퍼 미해제 (4곳)
2. 워커 `getSourceSetting()` 래퍼 미해제 → 소스를 API로 바꿔도 조용히 크롤링 분기
3. 재고 수량 중첩(`inventoryDetails.totalOrderableQuantity`)을 평면 선언 → 983행 전부 null
4. 완전성 가드가 해석 **전** 행 수로 판정 → clobber
5. 정산 페이징 토큰 이름(`token` vs `nextToken`) → 첫 페이지 무한 반복

**쓰기에서 같은 유형이 터지면 잘못된 가격이 실제로 반영된다.** 따라서 **실물 응답 샘플을 픽스처로 고정한 파싱 테스트를 먼저 쓰고** 구현을 시작한다(`worker/src/coupang-api/__tests__/`, 기존 회귀 23건 옆).

## 10. 안전장치 요약

| 장치                   | 내용                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| 사람 승인              | v1 전 건. 자동 실행 없음                                                 |
| 역할 게이트            | `requiredRole: ADMIN`                                                    |
| 미리보기               | 현재가 → 목표가, Δ%, 미반영 할인·프로모션 고지                           |
| 실행 직전 대조         | 현재가 재조회, 불일치 시 ABORT                                           |
| `forceSalePriceUpdate` | **기본 off.** 쿠팡 자체 변동폭 가드를 끄는 스위치. 액션별 명시 플래그    |
| 매핑 가드              | 브리지 1:1 아니면 제외                                                   |
| VAT 가드               | `includeVat=false` 시나리오 차단                                         |
| 멱등                   | `AgentPendingAction.idempotencyKey` + `CoupangWriteJob.actionId @unique` |
| 감사                   | `beforeState` + `observedPrice` + `result`                               |
| 롤백                   | 역방향 액션 생성 (별도 기계 없음)                                        |
| 알림                   | 성공·실패·중단 전부 Slack                                                |

## 11. 검증 계획

1. **픽스처 파싱 테스트** — 구현 전에 먼저 고정한다. 대상 2개:
   - 가격 변경 PUT 응답 (성공 / `data.code: "ERROR"` / HTTP 에러)
   - **아이템별 수량/가격/상태 조회 응답** (신규 래퍼)
2. **액션 정의 단위 테스트** — paramsSchema 검증, VAT 가드, 1:N 매핑 가드, force 기본값, 쿠팡 워크스페이스 미연결 시 생성 거부
3. **워커 대조 로직 테스트** — 세 분기 전부: 일치→PUT, 불일치→ABORT(PUT 미호출), 이미 targetPrice→SUCCEEDED(PUT 미호출)
4. **prod 실쓰기 1건** — 본인 계정 옵션 1개에 소액 변경 후 원복. no-op(같은 값)은 검증이 안 되므로 실제로 값을 바꾼다

## 12. 운영 함정 (기존 인프라에서 승계)

- **IP allowlist 필수** — 모든 호출은 워커에서. 현재 등록 IP `112.152.74.59`. ISP가 회선을 바꾸면 전 스코프가 동시에 죽는다(IP 거부는 별도 알림으로 분류돼 있다)
- 워커는 워크트리에서 돌며 **main 병합 후 프로세스 kill 필요**(launchd 자동 재기동)
- preview 환경에 `ENCRYPTION_KEY` 없음 → 자격 암호화 QA 불가
- 상품 목록 조회는 `businessTypes=rocketGrowth` 필수
- API 응답의 `productId` 필드는 별개 내부 ID — DB `productId` 는 `sellerProductId` 축
- 자격 위치: `~/.config/workdeck/coupang-api.env` (0600). 문서에 키를 적지 않는다

## 13. 재사용 자산

| 자산                                  | 위치                                     |
| ------------------------------------- | ---------------------------------------- |
| CEA HMAC 서명                         | `worker/src/coupang-api/signature.ts`    |
| 클라이언트(스로틀·백오프·IP거부 분류) | `worker/src/coupang-api/client.ts`       |
| 상품 API 순회                         | `worker/src/coupang-api/product-map.ts`  |
| 옵션 브리지                           | `src/lib/sh/external-option-bridge.ts`   |
| 승인 큐 코어                          | `src/lib/agent/actions/`                 |
| 승인 UI                               | `src/components/approvals/`              |
| Slack 알림                            | `src/lib/slack/notify-pending-action.ts` |
| 폴링 패턴                             | `worker/src/manual-poller.ts`            |
| 자격 저장(AES-256-CBC)                | `CoupangApiCredential`                   |
