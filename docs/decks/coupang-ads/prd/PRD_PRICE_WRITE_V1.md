# PRD — 쿠팡 Open API 가격 쓰기 (v1)

**작성** 2026-09-11 · **개정** 2026-09-12(축·가드 전면 수정) · 2026-09-22(운영·실행 정책 확정) · **Deck** coupang-ads (진입점은 seller-hub 가격시뮬) · **상태** 설계 승인 대기

> **개정 요약** — 초판 대비 바뀐 것: ① 쓰기 축이 `InvProductOption` → **`ProductListing`** (prod 실측으로 옵션 축이 1:N으로 깨짐을 확인) ② 대상 채널이 로켓그로스 단독 → **판매자배송·로켓그로스 2채널** ③ 현재가 일치 가드·`PRICE_REFRESH`·`force` **전부 삭제** ④ **쿠팡 자동 가격조정(`apActive`/`apMinSalePrice`) 동시 설정**이 v1 범위에 포함 ⑤ Wing 딥링크 추가.

## 1. 배경

쿠팡 Open API를 **읽기(수집) 소스**로 붙이는 작업은 2026-09-11 종결됐다. 5개 스코프 중 4개(광고·재고·판매·정산)가 로켓그로스 미커버 또는 컬럼 결손으로 잠겼고, 상품 스코프만 열려 있다. 상세는 메모리 `project_coupang_open_api_source.md`.

남은 미탐색 영역이 **쓰기 API(~55개)** 다. 크롤링으로 가격을 바꾸려면 Wing DOM 자동화가 되고, 이는 Akamai 차단·화면 변경에 그대로 노출된다(이 프로젝트가 반복 실패한 유형). API 쓰기는 공식 계약이고 실패가 코드로 온다.

**읽기를 죽인 병목이 쓰기에는 없다.** 공식 문서상 로켓그로스/하이브리드 상품의 판매가·재고·판매상태·할인율기준가는 상품수정 API가 아니라 **옵션별(`vendorItemId`) 변경 API로만** 변경 가능하다. RG `vendorItemId`가 정규 경로다.

> [상품 수정 (로켓그로스 또는 마켓플레이스/로켓그로스 동시 운영 상품)](https://developers.coupang.com/hc/ko/articles/39407792403609-%EC%83%81%ED%92%88-%EC%88%98%EC%A0%95-%EB%A1%9C%EC%BC%93%EA%B7%B8%EB%A1%9C%EC%8A%A4-%EB%98%90%EB%8A%94-%EB%A7%88%EC%BC%93%ED%94%8C%EB%A0%88%EC%9D%B4%EC%8A%A4-%EB%A1%9C%EC%BC%93%EA%B7%B8%EB%A1%9C%EC%8A%A4-%EB%8F%99%EC%8B%9C-%EC%9A%B4%EC%98%81-%EC%83%81%ED%92%88) · [상품 아이템별 가격 변경](https://developers.coupang.com/ko/api/products/changing-price-of-each-item-of-a-product)

## 2. 목표

가격시뮬레이션에서 산출한 판매가를 **승인 큐를 거쳐 쿠팡 실판매가에 반영**한다. 지금은 사람이 Wing에서 손으로 옮긴다. 함께 **자동 가격조정 하한**도 시뮬의 최소마진가로 설정한다.

**v1 범위는 액션 1종이다.** 이 레포는 읽기에서 5개 스코프를 짓고 4개를 잠갔다. 가격 하나를 끝까지 관통시키고, 판매중지/재개·쿠폰은 검증된 레일 위에 `ActionDefinition` 추가로 축소한다.

### 비목표 (v1)

- 판매중지/재개, 수량 변경, 쿠폰 발행 — v2 이후
- 조건부 자동 실행 — §9
- 고객용 쿠팡 상품 페이지 딥링크 — §8 (공개 `productId` 미보유)
- 리스팅 ↔ 쿠팡 옵션 전수 매칭 화면 — §6 (지연 매핑으로 대체)
- 물류·배송·반품 쓰기 계열 — RG 중심 운영이라 효용 낮음

## 3. 쓰기 축 — 옵션이 아니라 리스팅 (개정 핵심)

초판은 `InvProductOption` → `vendorItemId` 로 잡았다. **prod 실측에서 그 축이 깨졌다.**

```
내부옵션 → 외부옵션 (쓰기에 필요한 방향), prod 실측
  1:1 →  18건        ← 쓸 수 있는 건 이것뿐
  1:2 →  15건   1:3 → 20건   1:4 →  6건
  1:5 →   9건   1:6 → 10건   … 1:12 → 3건
  브리지에 걸린 내부 옵션 86건 / 전체 964건
```

원인은 **세트 상품**이다. 내부 옵션 "딥그린" 하나가 쿠팡의 1·2·3·4개입 리스팅에 모두 들어간다. 그래서 "이 옵션의 가격"이라는 것이 존재하지 않는다. **가격은 리스팅에 하나씩 붙는다.**

올바른 축:

```
ProductListing (쿠팡 채널)  ↔  쿠팡 옵션(vendorItemId)   1:1
```

prod 실측 뒷받침:

```
쿠팡 채널 ProductListing 250개 (로켓그로스 연동 채널은 0개 — 미러링이라 대표 채널에만 존재)
  "…딥그린 1개"  16,900
  "…딥그린 2개"  29,800   ← 색상×수량 조합마다 별도 리스팅 = 쿠팡 옵션 하나
  "…딥그린 3개"  41,800
구성품 분포: 250개 중 225개가 구성품 1종(옵션 × 수량 N), 25개가 혼합 세트
internalCode 는 250건 전부 null — 외부 식별자를 담을 자리가 비어 있다
```

### 3.1 가격그룹 → 리스팅은 자동 유도한다

시뮬의 `ResolvedComponent` 는 `optionIds[]`(같은 가격의 옵션 묶음) + `quantity` 를 갖는다. 리스팅은 `ProductListingItem(optionId, quantity)` 를 갖는다. **구성 시그니처가 같으면 같은 판매 단위다.**

```
가격그룹 { optionIds: [딥그린, 베이지, 차콜], quantity: 1 }
  → 리스팅 "…딥그린 1개" / "…베이지 1개" / "…차콜 1개"   (색상 수만큼 N개)
```

요구사항 "액션을 하면 해당 상품의 모든 옵션에 가격이 적용"이 이 유도로 그대로 충족된다.

**이름 매칭은 쓰지 않는다.** `ChannelProductAlias` 가 같은 발상으로 매칭률 0 이었다(2026-08-05 실측).

한계: (optionId, quantity) 시그니처가 유일하지 않은 조합이 **30개(리스팅 60개)** 있다. 이 경우 자동 유도가 1:N이므로 사람이 고른다(§6).

## 4. 대상 채널 — 2개, 각각 별도 승인

prod 실측상 시나리오 13개 중 12개가 쿠팡 채널 **2개**를 함께 쓴다.

| 시뮬 채널         | `Channel.externalSource` | 성격                                         | 쓰기 타깃        |
| ----------------- | ------------------------ | -------------------------------------------- | ---------------- |
| `쿠팡`            | `null` (대표)            | 판매자배송 = 마켓플레이스                    | `mpVendorItemId` |
| `쿠팡 로켓그로스` | `coupang_rocket_growth`  | 연동(미러). `representativeChannelId → 쿠팡` | `rgVendorItemId` |

둘 다 **실판매가**다. 실측 `manualPrices` 예: 모달 나시 5개세트 101,200 / 101,200(동일), 쿨 메쉬 브라 2개 48,200 / 48,500(300원 차).

채널 식별은 **`externalSource` 로 한다.** 이름 휴리스틱(`name.includes('로켓그로스')`)을 쓰지 않는다.

**액션은 채널당 1개, 승인도 채널당 1번이다.** 한 채널이 실패해도 나머지가 살고, 감사 기록이 채널 단위로 깔끔하다. 미리보기 화면에서는 두 채널을 함께 보여주되 액션은 각각 생성한다.

## 5. 가격 매핑 규칙

시뮬에는 가격이 4겹, 쿠팡에는 2개다.

```
시뮬:  salePrice → ×(1 - discountRate) → 프로모션 적용 → finalPrice
쿠팡:  PUT .../prices/{price}            (판매가)
       PUT .../original-prices/{price}   (할인율 기준가)
```

**결정: `salePrice`(할인·프로모션 적용 전)만 쿠팡 판매가(`prices`)로 민다.**

- `original-prices` 는 v1에서 건드리지 않는다.
- 사용자는 **시뮬의 할인·프로모션을 참고해 실제 쿠팡 쿠폰을 운영한다.** 따라서 `finalPrice` 를 판매가로 밀면 쿠폰이 또 걸려 **이중 할인이 실제로 발생한다.**
- ~~바로 옆 기존 버튼 `채널 상품 생성` 은 `cell.finalPrice`(할인·프로모션 후)를 쓴다~~ — **정정(2026-09-22 실측)**: 사실이 아니었다. `cell` 은 `headlineMatrix.cells[0]` 이고(`pricing-channel-board-card.tsx:201`), 그 매트릭스는 `promotion: { type: 'NONE', value: 0 }` 로 생성되며 `cells[0]` 은 할인 0% 컬럼이다. 따라서 `cell.finalPrice === effectivePrice === manualPrice ?? 권장가` 로, **기존 버튼도 이미 할인·프로모션 적용 전 가격을 쓴다.** 두 버튼의 금액은 항상 같다.
  - 결정 자체는 바뀌지 않는다 — 쿠팡에 미는 값은 할인·프로모션 전 판매가다. 다만 "옆 버튼과 달라서 혼동을 막아야 한다"는 근거는 성립하지 않았다. `finalPrice` 를 밀 때의 이중 할인 위험은 그 버튼에 관한 한 애초에 없었다.
  - **버튼 라벨에 금액을 박는 것은 유지한다** — 두 버튼을 구분하기 위해서가 아니라, 사람이 승인하는 숫자를 버튼에서 바로 보게 하기 위해서다.
- 미리보기에 명시한다: "이 시나리오에는 할인 N% / 프로모션 X가 있으나 쿠팡 판매가에는 반영되지 않습니다."

### 5.1 VAT

`pricing-calc.ts:99` 기준 `includeVat=true`(기본값)이면 `salePrice` 는 **VAT 포함 실결제가**다(메모리 `project_pricing_sim_margin_gross_base` 의 gross 전환 결과). 쿠팡 판매가도 VAT 포함 소비자가라 기준이 일치한다.

**가드**: `includeVat=false` 시나리오는 ex-VAT라 그대로 밀면 10% 낮게 반영된다. → **쓰기 차단**하고 사유를 표시한다. 자동 gross-up 하지 않는다.

### 5.2 10원 단위

쿠팡 `price` 는 **최소 10원 단위**다. 권장가 자동(`snap=false`)이면 `Math.round(good)` 라 1원 단위가 나올 수 있고 그대로 밀면 400이다.

→ 10원 단위로 **반올림**하고, **반올림된 값을 미리보기에 표시**한다. 사람이 그 숫자를 보고 승인하므로 추측이 아니다.

### 5.3 `forceSalePriceUpdate` 는 쓰지 않는다

문서상 제한은 **인하 최대 50% / 인상 최대 100%** 로 관대해 정상 운영에서 걸리지 않는다. 걸리면 쿠팡 에러 메시지를 그대로 보여주고 사람이 판단한다. 안 쓸 위험한 스위치를 미리 짓지 않으며, 쿼리 파라미터 서명 이슈도 함께 사라진다.

## 6. 리스팅 ↔ 쿠팡 옵션 연결 — 지연 매핑

전수 매칭을 하지 않는다. 사용자가 실제로 가격을 조정하는 리스팅은 **일부에 집중**돼 있다.

미리보기 시점에 해당 리스팅에 쿠팡 옵션이 아직 연결돼 있지 않으면 **피커를 띄워 한 번 고르게 하고 저장**한다. 자동 제안은 상위 후보만 올리고 **확정은 사람**이 한다. 실제로 쓰는 리스팅부터 채워진다.

### 6.1 신규 모델 `CoupangProductItem`

상품 API 응답에서 **한 `item` 객체 = 한 옵션이고, 그 안에 RG·MP `vendorItemId` 가 나란히 있다.** 따라서 짝맞춤 로직이 필요 없고, 축별로 행을 나눌 이유도 없다(초판의 `axis` enum 폐기).

```
CoupangProductItem
  spaceId
  sellerProductId        ← Wing 딥링크 = vendorInventoryId (§8, 실측 확인)
  itemName
  rgVendorItemId  rgSalePrice
  mpVendorItemId  mpSalePrice
  barcode                ← RG쪽에만 존재. MP는 빈 문자열
  skuInfo   Json         ← RG 전용. 치수·무게·quantityPerBox·유통기한
  statusName
  collectedAt
  listingId  (nullable, unique)   ← 지연 매핑의 저장소

  @@unique([spaceId, rgVendorItemId])
```

`ProductListing` 에 쿠팡 전용 컬럼을 붙이지 않는다 — 공용 모델이 채널별 필드로 오염된다.

이 한 행이 세 가지를 동시에 해결한다: **가격 쓰기 타깃 · Wing 딥링크 · 판매채널 상품 화면 링크.**

실물 응답 근거:

```json
rocketGrowthItemData: {
  vendorItemId: 96037831212,
  priceData: { originalPrice: 35000, salePrice: 65790, supplyPrice: 63619 },
  barcode: "8809903551648",
  skuInfo: { width:90, length:90, height:80, weight:250, quantityPerBox:1, distributionPeriod:365, expiredAtManaged:true }
}
marketplaceItemData: {
  vendorItemId: 95847019386,
  priceData: { originalPrice: 105000, salePrice: 67800, supplyPrice: 65563 },
  barcode: ""
}
```

⚠️ 가격은 `…ItemData.priceData.salePrice` — **2단 중첩**이다. 평면 `salePrice` 로 선언하면 타입 에러 없이 전건 null 이 된다(§11 유형 3과 동일).

### 6.2 수집

기존 `worker/src/coupang-api/product-map.ts` 의 목록→단건 순회를 재사용한다(상품 55개 × 1.3초 스로틀 ≈ 70초). **매일 1회** + 수동 트리거. 상품 목록 조회는 `businessTypes=rocketGrowth` 필수.

`CoupangSourceSetting` 에 넣지 않는다. 저 모델은 CRAWL/API **소스 전환** 토글이고, 상품 API는 크롤링을 대체하지 않는 **보강 데이터**다. 그 토글로 지은 5개 중 4개가 잠겼다 — 같은 실수를 이름만 바꿔 반복하지 않는다.

### 6.3 재고 대조 매핑과의 공통화 — 검토 결과

재고 대조(`/d/seller-ops/inventory/reconciliation`)에도 유사한 매핑 단계가 있다. 발상은 같다 — 자동 실패 시 사람이 확정하고 결과를 저장해 재사용하는 지연 매핑.

**데이터 모델은 합치지 않는다.**

|           | 재고 대조                                                    | 가격 쓰기                                    |
| --------- | ------------------------------------------------------------ | -------------------------------------------- |
| 매핑 대상 | 외부코드 → `InvProductOption[]` **+ 수량비율** (팬아웃 필수) | vendorItemId → `ProductListing` **1:1**      |
| 유니크 키 | `(locationId, externalCode)` — **위치 축**                   | `(spaceId, rgVendorItemId)` — 위치 개념 없음 |
| 수명      | 업로드마다 재사용되는 영속 사전                              | 리스팅당 1회 고정                            |

`InvLocationProductMap` 에 얹으면 쓰지도 않을 `locationId` 를 억지로 채우고 `items[]` 팬아웃을 놀린다. §3에서 옵션 축이 1:N으로 깨진 것이 정확히 이 차이 때문이다 — **재고는 옵션 축, 가격은 리스팅 축.**

**UI는 이미 공용이다.** 재고 대조가 쓰는 피커는 `sh/inventory` 가 아니라 `src/components/sh/products/listings/option-picker-dialog.tsx`(665줄)에 있고, 토큰 검색도 `@/lib/inv/search-tokens` 로 추출돼 있다. 값어치의 핵심은 **토큰 AND 검색 + 키워드 칩 + 0건이면 마지막 토큰을 떼고 단계적 완화 재검색** UX다(메모리 `project_recon_picker_token_search`).

→ **검색·칩·완화 로직을 공용 훅으로 추출하고 후보 소스만 주입한다.** 우리 피커는 고르는 대상이 쿠팡 옵션이라 다이얼로그 자체는 재사용할 수 없다. 665줄짜리를 통째로 제네릭화하는 것은 과하다.

## 7. 실행 경로

### 7.1 승인 큐는 기존 것을 그대로 쓴다

`AgentPendingAction` + `ActionDefinition`(`src/lib/agent/actions/`)에 이미 있다: `payload`, `summary`, `beforeState`, `idempotencyKey`, 만료, `requiredRole` 게이트, Slack 알림(`src/lib/slack/notify-pending-action.ts`), 승인 UI(`src/components/approvals/`). **새로 만들 안전장치가 거의 없다.**

`/approvals` 는 deck 게이팅이 없는 전역 페이지다. `deckKey` 는 배지 라벨용이다.

```ts
actionType:   'seller-hub.coupang-price.change'
deckKey:      'seller-hub'     // 가격 변경은 광고가 아니고, 되돌아갈 화면이 가격시뮬이다
requiredRole: 'ADMIN'
expiresAt:    now + 6h          // 기본 72h 대신 (§7.4)
params: {
  channelAxis: 'RG' | 'MP'
  targets: Array<{ listingId, vendorItemId, targetPrice, apMinSalePrice }>
  apActive: boolean
  rationale: { ... }            // 불변 근거 스냅샷 (§7.3)
  scenarioId?: string           // 보조 링크
}
```

### 7.2 `execute()` 는 쿠팡을 직접 부르지 않는다

쿠팡 API는 allowlist 등록 IP(워커, 현재 `112.152.74.59`)에서만 호출된다. `execute()` 는 Vercel에서 돈다. 따라서 `execute()` 는 **`CoupangWriteJob` PENDING 행을 만들고 끝낸다.** 워커가 30초 폴링해 실제 PUT을 수행한다 — `worker/src/manual-poller.ts` 패턴 그대로(워커에는 HTTP 수신부가 없다).

```
CoupangWriteJob
  workspaceId                    ← resolveCoupangWorkspaceForSpace(spaceId) 로 해석 (§7.5)
  actionId  @unique              ← 멱등
  kind      PRICE_CHANGE
  payload   Json
  status    PENDING|RUNNING|SUCCEEDED|FAILED|PARTIAL
  attempts
  results   Json                 ← 타깃별 { vendorItemId, observedPrice, ok, error }
  executedAt
```

### 7.3 근거 스냅샷은 payload 안에 박는다

시뮬 저장을 강제하지 않는다(기존 `채널 상품 생성` 도 라이브 상태로 동작한다). `scenarioId` 참조만으로는 감사가 안 된다 — 시나리오는 나중에 수정·삭제된다. **승인 시점의 근거**가 액션 안에 남아야 한다.

담을 것: 원가, 채널 수수료율, 배송비, 목표마진, 계산된 마진율, 미반영 할인율·프로모션, `includeVat`/`vatRate`.

### 7.4 현재가 대조 가드는 두지 않는다

초판은 PUT 직전에 현재가를 읽어 `expectedCurrentPrice` 와 다르면 중단하도록 했다. **자동 가격조정(§9)을 쓰는 환경에서 이 가드는 틀렸다.**

- 자동조정은 **설계상 가격을 수시로 바꾼다.** 가드를 두면 대부분의 쓰기가 중단된다.
- 더 근본적으로, 승인자가 결정한 것은 "판매가를 X로, 하한을 Y로"이지 "현재가가 Z일 때만"이 아니다. 하한과 판매가 사이에서 가격이 움직이는 것은 **의도된 동작**이다.

버리는 것: `expectedCurrentPrice` 일치 검사 · ABORT 상태 · 크래시 복구 no-op 분기(가격 PUT은 자연 멱등) · 미리보기 전 갱신(`PRICE_REFRESH`).

남는 보호막:

1. **승인 유효기간 6시간.** 반나절 지난 판단으로 실판매가를 바꾸지 않는다
2. **쿠팡 자체 변동폭 가드** — 인하 50% / 인상 100%. `force` 를 쓰지 않으므로 살아 있다
3. **`observedPrice` 기록** — 차단용이 아니라 **감사용**. PUT 직전 실제 가격을 남긴다

잃는 것: 승인~실행 사이(워커 폴링 30초 이내)에 누가 Wing에서 의도적으로 가격을 바꾸면 덮는다. 창이 수십 초라 감수한다.

부수 효과로 미리보기의 현재가는 **참고 표시**가 되어 하루 묵어도 무방하다.

### 7.5 Space 축과 Workspace 축

`ActionExecContext` 는 `{ spaceId, requestedBy }` 만 갖고 workspaceId 가 없는데, 워커 폴링과 자격 조회는 workspaceId 를 요구한다. **이 축 혼동은 이 기능에서 이미 버그로 나갔다** — `54b2f882 fix(coupang-ads): API 자격 저장·연결 테스트 실패 (워크스페이스 축 + 응답 래퍼)`.

- 정식 해석 경로는 **`resolveCoupangWorkspaceForSpace(spaceId)`** 다(`src/lib/sh/margin-query.ts:229` 에서 동일하게 사용).
- **nullable 이다.** 쿠팡 워크스페이스가 연결돼 있지 않으면 액션 생성 자체를 거부한다(승인 후 워커에서 터지게 두지 않는다).

### 7.6 워커 `price-writer.ts`

```
1. PENDING job 1건 claim (RUNNING 전이)
2. 타깃별 순차 처리 (1.3초 스로틀 × N)
   a. 현재가 조회 → observedPrice 기록 (감사용, 차단 안 함)
   b. PUT .../vendor-items/{vendorItemId}/prices/{price}?apActive={bool}&apMinSalePrice={min}
   c. 응답 body 검증 (§10)
   d. 타깃 결과를 results[] 에 누적
3. 전건 성공 SUCCEEDED / 일부 실패 PARTIAL / 전건 실패 FAILED
4. CoupangProductItem 가격 갱신 → Slack 알림
```

**부분 실패는 롤백하지 않는다.** 성공한 건 성공으로 두고 결과 표에 건별 상태를 표시한다. 재시도는 같은 잡을 다시 돌리면 되며, 가격 PUT은 자연 멱등이라 이미 반영된 건도 같은 결과가 된다.

**롤백**은 별도 기계를 만들지 않는다. `observedPrice` 를 목표가로 하는 **새 액션 생성**이 롤백이다.

⚠️ 현재가 조회 엔드포인트 래퍼는 **아직 없다.** `endpoints.ts` 의 래퍼 8종에 "상품 아이템별 수량/가격/상태 조회"가 없다. 신규 래퍼 + 자체 픽스처 파싱 테스트가 필요하다(응답 4필드: `sellerItemId`·`amountInStock`·`salePrice`·`onSale`).

## 8. Wing 딥링크

`vendorInventoryId` = `sellerProductId` 임을 실측으로 확인했다(사용자 제공 URL의 `15310472532` 가 상품 API 목록에 존재).

```
https://wing.coupang.com/tenants/seller-web/vendor-inventory/modify?vendorInventoryId={sellerProductId}
```

붙일 자리 2곳:

- 가격시뮬 채널 보드 카드 (채널별)
- 판매채널 상품 목록·상세

**고객용 쿠팡 상품 페이지 링크는 v1에서 제외한다.** 공개 `productId`(예: `8663709507`)는 `sellerProductId`·`vendorItemId`·`itemId`·`sellerProductItemId` 어느 것과도 다른 별개 축이고, 상품 API 응답 어디에도 없다. `vp/products/0?vendorItemId=…` 형태는 "요청하신 페이지의 사용권한이 없습니다"로 거부됨을 실브라우저로 확인했다. 확보하려면 Wing 크롤링 추가가 필요하고, RG축과 MP축이 같은 `productId` 를 공유하는지도 미확인이다.

## 9. 쿠팡 자동 가격조정 — v1 범위에 포함

사용자는 자동 가격조정을 **대부분의 옵션에 켜서 운영 중**이다. API는 가격 변경 시 함께 설정할 수 있다.

```
apMinSalePrice   자동조정 최저가. "Must be less than path {price}"
apActive         자동조정 활성 여부
```

**둘은 반드시 함께 보내야 한다** — `apMinSalePrice` 단독은 400 ("apMinSalePrice and apActive must be provided together").

모델: `price` 가 상한(정상 판매가), `apMinSalePrice` 가 하한. 쿠팡이 그 범위 안에서 시세를 따라 조정한다.

### 9.1 최저가는 시뮬에서 가져온다

`recommendedRetail.min` = `calcRetailForTarget(globals.minimumAcceptableMargin, inputs)` — **최소허용마진(기본 12%) 달성 추천가**이고 채널별로 계산된다. 게다가 **할인·프로모션 0% 기준**이라 §5에서 정한 "할인 전 판매가"와 기준이 같다.

```
price          = manualPrice ?? recommendedRetail.good   (상한, 10원 반올림)
apMinSalePrice = recommendedRetail.min                   (하한, 10원 올림)
```

하한은 **올림**이다. 내리면 쿠팡이 마진 밑으로 팔 수 있다.

**가드**: `apMinSalePrice < price` 가 쿠팡 요구조건이다. 사용자가 판매가를 최소마진가보다 낮게 수동 설정하면 400이므로 **미리보기에서 차단**한다.

### 9.2 `apActive` 는 사람이 매번 확인한다

**현재 자동조정 상태를 API로 읽을 수 없다.** 조회 API 응답은 `sellerItemId`·`amountInStock`·`salePrice`·`onSale` 4필드뿐이고, 상품 단건 응답에도 자동조정 필드가 없다(실측 확인). 그런데 반드시 함께 보내야 하므로 **워크덱이 옵션별 자동조정 on/off의 사실상 주인이 된다.** 일부러 꺼둔 옵션을 켜버릴 수 있다.

→ 미리보기에 자동조정 블록을 **명시적으로 띄우고 매번 사람이 확인**한다.

```
☑ 자동 가격조정 유지          ← 기본 체크됨
   최저가  ₩58,200  (최소마진 12% 기준)
   ⚠ 쿠팡은 이 옵션의 현재 자동조정 상태를 알려주지 않습니다.
     체크를 해제하면 자동조정이 꺼집니다.
```

"우리가 모른다"를 화면에 적는 것이 핵심이다. 사람이 매번 보고 승인하면 추측이 아니라 결정이 된다. 워크스페이스 전역 기본값으로 덮지 않는다 — 옵션마다 다를 수 있는 것을 전역 설정으로 덮으면 조용히 틀린다.

## 10. 응답 파싱 — HTTP 200 은 성공이 아니다

```json
{ "code": "200", "message": "", "data": { "code": "SUCCESS", "message": "", "data": 427011919 } }
```

성공 판정은 **중첩된 `data.code === "SUCCESS"`** 다. HTTP 200을 성공으로 읽으면 "가격이 반영됐다"고 보고하고 실제로는 안 바뀐다. 실패는 대부분 **HTTP 400** 이며 사람이 읽을 수 있는 메시지가 온다("변경전 판매가의 최대 50% 인하/최대 100%인상까지 변경가능합니다", "최소 10원 단위로 입력가능합니다", "삭제된 상품은 변경이 불가능합니다"). 이 메시지를 그대로 결과에 남긴다.

`client.ts` 는 현재 **GET 전용**이다. `put<T>()` 을 추가한다 — CEA 서명 message 는 `signedDate + method + path + query` 로 **body를 포함하지 않으므로** 서명 로직은 그대로다. 스로틀·429 백오프·IP 거부 분류도 재사용한다.

단 `apActive`·`apMinSalePrice` 는 **쿼리 파라미터**라 `buildQueryString()` 을 거쳐 **서명 message 에 들어간다.** 서명에 쓴 query 문자열과 실제 요청 URL 의 순서가 어긋나면 서명 불일치로 실패한다(`signature.ts` 의 "정렬하지 않는다" 규약). `get()` 과 같이 한 번만 만들어 양쪽에 쓴다.

## 11. 이 기능의 알려진 실패 유형

읽기 구축에서 나온 무음 실패 5건은 **전부 같은 유형**이었다 — 타입이 실물과 달라 타입 에러 없이 조용히 `undefined` 가 되고 증상만 나타남.

1. UI가 `{credential}`/`{setting}`/`{run}` 응답 래퍼 미해제 (4곳)
2. 워커 `getSourceSetting()` 래퍼 미해제 → 소스를 API로 바꿔도 조용히 크롤링 분기
3. 재고 수량 중첩(`inventoryDetails.totalOrderableQuantity`)을 평면 선언 → 983행 전부 null
4. 완전성 가드가 해석 **전** 행 수로 판정 → clobber
5. 정산 페이징 토큰 이름(`token` vs `nextToken`) → 첫 페이지 무한 반복

**쓰기에서 같은 유형이 터지면 잘못된 가격이 실제로 반영된다.** 따라서 **실물 응답 샘플을 픽스처로 고정한 파싱 테스트를 먼저 쓰고** 구현을 시작한다(`worker/src/coupang-api/__tests__/`, 기존 회귀 23건 옆).

이 스펙에서 이미 같은 유형을 둘 잡았다: `priceData.salePrice` 2단 중첩(§6.1), `rocketGrowthItemData.vendorItemId` 중첩.

## 12. 안전장치 요약

| 장치              | 내용                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| 사람 승인         | v1 전 건. 자동 실행 없음                                                                      |
| 역할 게이트       | `requiredRole: ADMIN`. ⚠️ **웹 승인 경로에만 적용된다** — 아래 참조                           |
| 승인 유효기간     | **6시간** (기본 72h 대신). 승인 게이트의 `expiresAt` 검사(§16.2)가 있어야 실제로 강제된다     |
| 미리보기          | 현재가 → 목표가, Δ%, 자동조정 블록, 미반영 할인·프로모션 고지, 반올림된 실제 금액             |
| 쿠팡 변동폭 가드  | 인하 50% / 인상 100%. `force` 미사용으로 유지                                                 |
| 매핑 가드         | 리스팅 ↔ 쿠팡 옵션 미연결이면 피커 강제                                                       |
| VAT 가드          | `includeVat=false` 시나리오 차단                                                              |
| 자동조정 가드     | `apMinSalePrice < price` 위반 시 차단                                                         |
| 워크스페이스 가드 | 쿠팡 워크스페이스 미연결 시 액션 생성 거부                                                    |
| 멱등              | `AgentPendingAction.idempotencyKey` + `CoupangWriteJob.actionId @unique` + 가격 PUT 자연 멱등 |
| 감사              | `payload.rationale` + `observedPrice` + `results[]`                                           |
| 롤백              | 역방향 액션 생성 (별도 기계 없음)                                                             |
| 알림              | 성공·부분실패·실패 전부 Slack                                                                 |

### 12.1 Slack 승인 경로의 역할 게이트 부재 (운영 전제)

`app/api/slack/interactive/route.ts` 는 팀·채널 일치는 검사하지만 `def.requiredRole` 을 검사하지 않는다. 웹 PATCH 경로에만 역할 게이트가 있다. **즉 승인 Slack 채널에 있는 사람이면 누구나 실판매가 변경을 승인할 수 있다.**

이 브랜치가 만든 회귀가 아니라 기존 승인 큐의 구조이며(액션 2종에 이미 동일 적용), 고칠 재료가 없다 — `slackUserId` ↔ `User` 매핑이 스키마에 존재하지 않는다.

→ **운영 전제로 못박는다: 승인 채널(`SpaceSlackChannel kind='approvals'`)에는 ADMIN 만 둔다.** 실판매가를 바꾸는 첫 액션이 이 큐로 나가는 시점이므로, 이 전제를 문서에 남기지 않으면 아무도 모른다. Slack 사용자 매핑은 후속 과제.

## 13. 검증 계획

1. **픽스처 파싱 테스트** — 구현 전에 먼저 고정한다. 대상 3개:
   - 가격 변경 PUT 응답 (성공 / `data.code: "ERROR"` / HTTP 400 메시지)
   - 아이템별 수량/가격/상태 조회 응답 (신규 래퍼)
   - 상품 단건 응답의 `rocketGrowthItemData`·`marketplaceItemData` 중첩 파싱
2. **액션 정의 단위 테스트** — paramsSchema, VAT 가드, `apMinSalePrice < price` 가드, 워크스페이스 미연결 거부, 10원 반올림/올림
3. **가격그룹 → 리스팅 유도 테스트** — 시그니처 일치, 모호(1:N) 시 피커 요구
4. **워커 부분 실패 테스트** — 타깃 3개 중 1개 실패 시 PARTIAL, 나머지 2개는 반영됨
5. **승인 만료 게이트 테스트** — `expiresAt` 이 지난 PENDING 액션의 승인이 거부되고, "이미 처리됨"과 메시지가 구분되는지(§16.2)
6. **prod 실쓰기 — 2단계로 나눈다**

preview 에서는 검증할 수 없다. `ENCRYPTION_KEY` 가 없어 자격 복호화가 안 되고, IP allowlist 와 실자격이 prod 에만 있다. **main 배포 후 prod 에서 실제 판매가를 바꾸는 것이 유일한 경로**다.

**1단계 — 자동조정 파라미터를 생략하고 가격만**

```
PUT .../prices/{현재가 + 10}      ← apActive·apMinSalePrice 를 보내지 않는다
```

확인할 것 둘:

1. 가격이 실제로 반영되는가
2. **기존 자동조정 설정이 유지되는가** ← 문서로 확인하지 못한 유일한 미지수

파라미터를 생략하면 기존 설정이 유지된다는 것은 **가정**이다. 문서에 명시가 없다. 틀리면 자동조정이 꺼지고, 그것을 모른 채 §9 를 지으면 이후 전 옵션에 영향이 간다. Wing 화면에서 사람이 눈으로 확인해야 한다.

**2단계 — 자동조정 포함**

```
PUT .../prices/{price}?apActive=true&apMinSalePrice={최소마진가}
```

하한이 Wing 에 반영됐는지 확인한 뒤 원복한다. 원복도 같은 승인 흐름으로 수행해 롤백 경로까지 함께 검증한다.

**조건**

- 리스팅 1개. 판매가 적고 재고 여유가 있는 것으로 고른다(대상은 §17)
- 변동폭은 **10원**. 쿠팡 가드(인하 50%/인상 100%)에 한참 못 미치고 고객 영향도 무시할 수준이다
- 주문이 적은 시간대에 수행한다

⚠️ 자동조정이 켜져 있으면 **원복 후에도 쿠팡이 가격을 다시 움직인다.** "정확히 원래 숫자로 돌아왔는가"로 판정하면 안 되고, **우리 PUT 이 반영됐는가**로 판정한다.

## 14. 운영 함정 (기존 인프라에서 승계)

- **IP allowlist 필수** — 모든 호출은 워커에서. 현재 등록 IP `112.152.74.59`. ISP가 회선을 바꾸면 전 스코프가 동시에 죽는다(IP 거부는 별도 알림으로 분류돼 있다)
- 워커는 워크트리에서 돌며 **main 병합 후 프로세스 kill 필요**(launchd 자동 재기동)
- preview 환경에 `ENCRYPTION_KEY` 없음 → 자격 암호화 QA 불가
- 상품 목록 조회는 `businessTypes=rocketGrowth` 필수
- API 응답의 `productId` 필드는 별개 내부 ID — DB `productId` 는 `sellerProductId` 축
- 자격 위치: `~/.config/workdeck/coupang-api.env` (0600). 문서에 키를 적지 않는다
- `PricingScenarioChannel` 조인 테이블은 **비어 있다.** 시나리오의 단일 소스는 `inputSnapshot` JSON 이다

## 15. 재사용 자산

| 자산                                  | 위치                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CEA HMAC 서명                         | `worker/src/coupang-api/signature.ts`                                                          |
| 클라이언트(스로틀·백오프·IP거부 분류) | `worker/src/coupang-api/client.ts`                                                             |
| 상품 API 순회                         | `worker/src/coupang-api/product-map.ts`                                                        |
| RG·MP vendorItemId 추출               | `worker/src/coupang-api/endpoints.ts` `extractOptionIdentities`                                |
| 승인 큐 코어                          | `src/lib/agent/actions/`                                                                       |
| 승인 UI                               | `src/components/approvals/`                                                                    |
| Slack 알림                            | `src/lib/slack/notify-pending-action.ts`                                                       |
| 폴링 패턴                             | `worker/src/manual-poller.ts`                                                                  |
| 피커 토큰 검색                        | `src/lib/inv/search-tokens.ts`, `src/components/sh/products/listings/option-picker-dialog.tsx` |
| 채널별 반영 버튼 선례                 | `pricing-quick-flow.tsx` `handleCreateForChannel`                                              |
| 자격 저장(AES-256-CBC)                | `CoupangApiCredential`                                                                         |

## 16. 운영·실행 정책

### 16.1 일일 수집 트리거 — 앱 cron 이 잡을 만들고 워커가 집어간다

`app/api/cron/coupang-product-sync` 를 신설해 매일 `CoupangWriteJob(kind: PRODUCT_SYNC)` PENDING 행을 만든다. 워커는 §7.2 의 기존 폴링으로 그대로 집어간다. **워커에 새 스케줄 로직이 0줄**이고, "하루 1회"를 DB 가 보장하므로 워커 재기동에도 중복 실행이 없다. Vercel cron 라우트는 이미 8개 운영 중이라 패턴이 확립돼 있다(`with-cron-run` 이 인증·실행이력 담당).

정기 크롤링 스케줄러(`worker/src/collection-scheduler.ts`)에는 **얹지 않는다.** 그쪽은 Playwright·Akamai 로그인 쿨다운·9분 소요에 묶여 있고, 상품 API 수집(70초, 브라우저 무관)과 성격이 다르다. 크롤링이 봇차단으로 죽으면 상품 수집까지 같이 죽는다.

### 16.2 승인 만료 게이트 — 공유 함수를 고친다

§7.1 에서 가격 액션 만료를 6시간으로 줄였지만, **현재 구조에서는 강제되지 않는다.**

```ts
// src/lib/agent/actions/execute.ts:31 — 승인 게이트
const gate = await prisma.agentPendingAction.updateMany({
  where: { id: actionId, status: 'PENDING' }, // ← expiresAt 을 보지 않는다
  data: { status: 'APPROVED', decidedBy, decidedAt: now },
})
```

`EXPIRED` 전환은 ① 목록 조회 시 lazy expire ② `/api/cron/agent-actions-expire` **하루 1회** 뿐이다. 즉 만료된 액션이라도 아직 전환되지 않았으면 **승인·실행된다.**

**수정: 게이트 조건에 `expiresAt: { gt: now }` 를 추가한다.** 공유 함수 한 곳이라 기존 액션 2종(`finance.transaction.reclassify`, `seller-hub.reorder.plan.create`)도 함께 보호된다. 호출부마다 막는 것보다 작고, 72시간 만료를 걸어둔 원래 의도에도 맞는다.

`gate.count === 0` 일 때 "이미 처리됨"과 "만료됨"을 구분해 메시지를 나눈다 — 지금은 둘 다 `CONFLICT` 로 뭉개져 사용자가 영문을 모른다.

### 16.3 재시도 — 앱 레벨 재시도 없음, stale 회수만

실패 유형을 나누면 재시도할 것이 거의 없다.

| 유형         | 예                                       | 재시도                                  |
| ------------ | ---------------------------------------- | --------------------------------------- |
| HTTP 400     | 변동폭 초과, 10원 단위 아님, 삭제된 상품 | 무의미 — 같은 입력이면 영구 실패        |
| 429          | 분당 제한                                | 이미 처리됨 — `client.ts` 가 3회 백오프 |
| IP_REJECTED  | allowlist 밖                             | 무의미 — 전 스코프 동시 사망, 별도 알림 |
| 네트워크·5xx | 일시                                     | 가치 있음                               |

PUT 재시도가 필요한 케이스는 사실상 5xx 뿐이고, 그것은 워커 크래시와 구분되지 않는다. **stale 회수 하나가 둘 다 덮는다.**

```
RUNNING 이 10분 초과 → PENDING 복귀, attempts + 1
attempts 가 2 를 초과   → FAILED ("워커가 반복해서 중단됨")
```

선례: `app/api/collection/backfill/route.ts:136` (RUNNING 60분 → FAILED), `app/api/collection/runs/pending/route.ts` (PENDING 10분 stale 무시), `app/api/sc/jobs/worker/route.ts:36` (CLAIMED 회수).

가격 PUT 은 자연 멱등이라 재실행이 안전하다. `PARTIAL` 상태에서 회수가 돌면 성공분까지 다시 PUT 하지만 **틀리지는 않는다**(같은 값). 타깃별 `ok` 를 보고 건너뛰는 분기는 넣지 않는다 — 1.3초 × 몇 건을 아끼자고 분기를 늘릴 값어치가 없다.

### 16.4 결과 알림 — 승인 메시지의 스레드 답글

기존 액션들은 `execute()` 가 즉시 끝나 결과 알림이 없다. 여기서는 워커가 나중에 실행하므로 결과를 따로 알려야 한다.

`notify-pending-action.ts:120` 이 이미 `slackChannelId` · `slackMessageTs` 를 저장하고 있다. → `postMessage` 에 `thread_ts` 만 얹으면 된다. **새 채널 설정도, 새 모델도 없다.**

```
[승인 대기] 쿠팡 로켓그로스 판매가 반영 — 3건
  └ [완료] 3건 중 3건 반영. 65,790 → 67,800 …
  └ [부분 실패] 3건 중 1건 실패: 쿠팡이 거부 —
     "변경전 판매가의 최대 50% 인하까지 변경가능합니다."
```

같은 맥락이 한 스레드에 모여, 나중에 "이 가격이 왜 이렇게 됐나"를 Slack 에서 그대로 따라갈 수 있다.

예외: IP_REJECTED 는 액션 하나의 문제가 아니라 전 스코프가 동시에 죽은 상황이다.

**개정(2026-09-22, 구현 중 확인):** 초판은 "기존 IP 거부 알림 경로로 보낸다"고 적었으나 **그런 경로가 없다.** 코드베이스의 IP 거부 처리는 `orchestrator.ts` 와 `verify.ts` 안에서 run/probe 결과에 `ipBlocked` 플래그를 싣는 인라인 코드이지 호출 가능한 알림기가 아니다. 알림기를 새로 만드는 것은 v1 범위 밖이다.

→ v1 에서는 **IP 거부를 만나면 타깃 루프를 즉시 중단**한다(남은 타깃을 1.3초씩 헛되이 시도하지 않는다). 결과 보고는 다른 실패와 같이 승인 스레드로 간다. 전용 알림기는 후속 과제로 남긴다.

`slackMessageTs` 가 없으면(Slack 미연동 space) 조용히 건너뛴다 — 알림 실패가 실행을 막지 않는다는 기존 규약을 따른다.

## 17. 미결

- **prod 실쓰기 검증 대상 리스팅** — §13-5 의 2단계 절차는 확정됐으나 대상 리스팅은 배포 시점에 사용자가 지정한다. 조건: 판매가 적고 재고 여유가 있을 것, 주문이 적은 시간대에 수행.
