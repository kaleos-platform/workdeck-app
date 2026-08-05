# MCP SKU/옵션 단위 공헌이익 보강 설계

주력 상품군의 SKU/옵션 단위 공헌이익률·마진율을 MCP로 조회할 수 있게 한다.
재고·원가의 기준은 내부 `InvProductOption`(SKU)으로 통합하고, 판매채널은 **판매가(매출) 차이에만** 관여한다.

## 1. 데이터 실측 (prod, 2026-08-05 읽기 전용 조회)

설계는 전부 아래 실측에 근거한다. 추정으로 채운 값 없음.

### 대상 상품군

| 상품군 | productId | 옵션 수 |
| --- | --- | --- |
| 모달 머드팬티 | `cmoimxy8z000004lkh9cf6car` | 14 |
| 모달 캡나시 | `cmoinccpy000004jsv82iv6l1` | 8 |
| 쿨 메쉬 브라 | `cmr70naoh000h04l5qdx4m8mb` | 8 |
| 펠트 수납박스 | `cmorvht4q000004jr29nycq7n` | 12 |
| 선 클렌징 패드 **벌크** | `cms1up2lg000u04l4f4r5s16h` | 1 |
| 선 클렌징 패드 **개별포장** | `cmosoqfwl002b04larnt553sf` | 3 |

선 클렌징 패드는 공식 상품명이 동일한 **별개 상품 2건**이다. 구분자는 `internalName`(벌크 / 개별포장)뿐이므로 검색 결과에 `internalName`을 반드시 실어 보낸다.

### 2026-07 실적 규모

- 직접배송: `DelOrder` 612건, 결제총액 23,623,316원, `DelOrderItem` 680줄
- 로켓그로스: `InventoryRecord`(VENDOR_ITEM_METRICS/로켓그로스) 매출 67,616,200원, 31일치
- 광고: `AdRecord` 19,346행, 광고비 27,387,040원, 캠페인 5개

### 귀속 가능성 (핵심 제약)

| 경로 | 실측 결과 |
| --- | --- |
| `DelOrderItem.optionId` 직접 매칭 | **0줄** |
| `DelOrderItem.listingId` 매칭 | 263 / 680줄 |
| 미매칭 | 417 / 680줄 (61%) |
| 로켓 `optionName` → `ChannelProductAlias` | **0% (213쌍 전부 실패)** — VENDOR `optionName`은 `"상품명, 옵션1, 옵션2"` 통짜 문자열이라 짧은 alias와 형식 불일치 |
| 로켓 `optionId` → `InvLocationProductMap.externalCode` 직접 | **0%** — `externalCode`는 3PL 창고코드(10141…) 또는 쿠팡 skuId(57898012…)이지 쿠팡 optionId(92143…)가 아님 |
| **로켓 3-hop 브리지** (아래) | **매출 24,284,200 / 67,616,200원 = 36%** |
| **광고비 3-hop 브리지** | **9,453,198 / 27,387,040원 = 35%** |

`InvProductOption`에 **`barcode` 컬럼이 존재하지 않는다.** 요청 필드 중 유일하게 스키마에 없는 항목 → `missingFields`로 명시한다.

## 2. 3-hop 외부 브리지

쿠팡 외부 식별자를 내부 옵션으로 잇는 유일하게 작동하는 경로. `AdRecord`와 `InventoryRecord`가 **같은 외부 optionId 공간**(예: `92143176219`)을 쓴다는 점이 출발점이다.

```
외부 optionId (AdRecord.optionId / VENDOR InventoryRecord.optionId)
  └→ INVENTORY_HEALTH InventoryRecord (optionId, skuId 동시 보유: 11,902행 전부)
       └→ InvLocationProductMap.externalCode = skuId  (로켓그로스 위치 25건)
            └→ InvLocationProductMapItem (optionId, quantity)
                 └→ InvProductOption  ← 내부 SKU 기준
```

- VENDOR 행은 `skuId`가 **전부 null**이라 직접 조인 불가 → INVENTORY_HEALTH를 사전으로 경유해야 한다.
- 한 외부코드가 여러 내부 옵션으로 팬아웃되면 `MapItem.quantity` 비례로 금액을 배분한다. (단순 조인 시 T4에서 30.5M > 24.3M로 중복 계상되는 것을 확인)
- `Space` ↔ `Workspace` 브리지는 기존 `resolveCoupangWorkspaceForSpace(spaceId)`를 재사용한다(로켓 위치의 `externalIntegrationKey`).

## 3. 광고비 귀속 2단 구조

우선순위대로 적용하고, 어느 단계에서 귀속됐는지 `attributionSource`로 표시한다.

1. **외부 optionId 브리지** — 옵션 단위 정밀 귀속. 실측 35% 커버.
2. **`AdCampaignProductMap`** (신규) — 캠페인 → 상품 단위. 1단계에서 안 잡힌 잔여 캠페인 광고비를 상품에 귀속하고, 상품 내 옵션 배분은 **해당 기간 옵션 매출 비례**로 한다.
3. 둘 다 실패 → `unallocatedAdCost`

prod 캠페인이 5개(캐미솔/머드팬티/전상품/수납박스/쿨메시브라)뿐이라 캠페인↔상품 수동 시드가 현실적이다. `전상품 ROAS 500 타깃`처럼 다상품 캠페인은 여러 행으로 매핑하고 매출 비례 배분한다.

## 4. 매출 귀속

`revenue`는 **귀속에 성공한 금액만** 담는다. 실패분은 `unattributedRevenue`로 분리하고 `coverageRatio`를 함께 반환한다 — 61% 미매칭을 숨긴 채 공헌이익률을 내면 숫자가 과대·왜곡되기 때문이다.

- 직접배송: `DelOrderItem.optionId` 직접 → 없으면 `listingId` → `ProductListingItem` 팬아웃. `DelOrder.paymentAmount`가 **주문 단위**이므로 라인별 `retailPrice` 비례로 배분한다.
- 로켓그로스: VENDOR `revenue30d`를 3-hop 브리지로 옵션 배분.
- 그 외 전부 `unattributedRevenue`.

## 5. 공헌이익 산식

```
contributionProfit = revenue - cogs - shippingCost - packagingCost - commissionFee - adCost
contributionMarginRatio = contributionProfit / revenue        (revenue = 0 이면 null)
```

- `cogs` = `costExVat(option.costPrice, option.costVatIncluded)` × 귀속수량 — 기존 `src/lib/sh/cost.ts` 재사용
- `commissionFee` = 판매가 × `ChannelFeeRate` — 기존 `lookupCategoryFeePct` + `Channel.vatIncludedInFee`/`paymentFeeVatIncluded` 재사용
- `shippingCost` = `Channel.shippingFeeType`(FIXED/PERCENT) 기준
- `packagingCost` = `ProductPricingSettings.defaultPackagingCost` — prod 실측값 **0**이고 `ProductionRunCost.category`도 `OTHER` 한 종류뿐 → 사실상 미관리. 0으로 계산하되 `missingFields`에 명시한다.

## 6. 채널 판매가 (`salesChannels[]`)

한 옵션이 여러 세트 리스팅에 속한다(모달 머드팬티 쿠팡 = 14옵션 / 72리스팅). **리스팅별로 전부 나열**하고 단가를 환산한다.

```
{ channel, channelId, listingId, channelProductId, channelOptionId,
  quantity, sellingPrice, unitSellingPrice, salePrice, commissionRate, feeAmount }
```

- `unitSellingPrice` = `listing.retailPrice ÷ 리스팅 총 구성수량`
- `channelProductId`는 내부 `ChannelProduct.id`다. 채널사 발급 상품ID/옵션ID는 저장되지 않으므로 `channelOptionId`는 `missingFields` 대상.
- 원가·재고는 여기 넣지 않는다. 채널은 판매가에만 관여한다.

## 7. 응답 형식

`summary`와 `rows`를 분리하고 기본 응답을 50KB 이하로 유지한다.

```
{ summary: {...}, rows: [...], page, pageSize, total, nextCursor, missingFields: [...], coverage: {...} }
```

`missingFields`는 값이 없을 때 `null`을 넣는 대신 필드명을 배열로 명시한다(스펙 요구).

## 8. 산출물

- `AdCampaignProductMap` 모델 + 마이그레이션
- `src/lib/sh/external-option-bridge.ts` — 3-hop 브리지
- `src/lib/sh/product-options-query.ts` — 옵션 조회
- `src/lib/sh/margin-query.ts` — 공헌이익 집계
- MCP tool `sellerhub_get_product_options`, `sellerhub_get_product_margin`
- REST `/api/sh/product-options`, `/api/sh/margin`, 매핑 CRUD
- 배분 산식 유닛 테스트

## 9. 검증 결과 (2026-08-05)

dev/preview DB는 **2026-06-20이 최신**이고 쿨 메쉬 브라도 없다. 2026-07 검증은 prod 읽기 전용 조회로만 가능하다.

### 옵션 조회 (prod 실측)

6개 상품군 전부 SKU/옵션 목록만 반환되는 것을 확인했다.

| 상품군 | 옵션 | 첫 옵션 |
| --- | --- | --- |
| 모달 머드팬티 | 14 | `MDP-NUD-2XL` 재고 90 · 원가 10,590 · 재고가치 953,100 · 안전재고 20 · 채널 6건 |
| 모달 캡나시 | 8 | `CMS-BLK-L` 재고 351 · 원가 9,787 · 재고가치 3,435,237 · 채널 14건 |
| 쿨 메쉬 브라 | 8 | `NUD-L` 재고 0 · 원가 7,273 · 채널 11건 |
| 펠트 수납박스 | 12 | `DGR-L` 재고 84 · 원가 5,905 · 채널 8건 |
| 선 클렌징 패드 벌크 | 1 | `60매` 원가 4,091 · 채널 0건 |
| 선 클렌징 패드 개별포장 | 3 | `1S` 재고 728 · 원가 455 · 채널 1건 |

`q='클렌징'` 검색은 동명이품 2건을 `internalName`(벌크 / 개별포장)으로 구분해 반환한다.
`missingFields`는 전 건에서 `["barcode","salesChannels[].channelOptionId"]`.

### 응답 크기

기본 pageSize 10 기준 35.8KB / 47.5KB / 35.9KB, 무필터 12.4KB — 전부 50KB 예산 이내.
`summary` 단독 173B로 `rows`와 분리된다. 옵션당 채널 리스팅 수 편차가 커서 pageSize만으로는
상한을 보장할 수 없어, 직렬화 바이트가 예산을 넘으면 rows를 뒤에서 잘라내고
`summary.truncatedForSize=true` + 절대 오프셋 `nextCursor`로 이어받게 했다.

### 2026-07 공헌이익 (prod 실측, 6개 상품군)

```
매출 35,124,287 / 원가 11,174,247 / 배송 3,908,400 / 수수료 3,676,876 / 광고비 9,769,671
공헌이익 6,595,093 · 공헌이익률 18.8% · 옵션 35건
미귀속매출 55,589,389 · 미귀속광고비 17,801,688
```

| 상품군 | 매출 | 공헌이익 | 공헌이익률 |
| --- | --- | --- | --- |
| 모달 머드팬티 | 19,901,977 | 3,043,112 | 15.3% |
| 모달 캡나시 | 12,496,620 | 2,329,591 | 18.6% |
| 쿨 메쉬 브라 | 2,307,200 | 1,234,532 | 53.5% |
| 펠트 수납박스 | 330,240 | -30,033 | -9.1% |
| 선 클렌징 패드 개별포장 | 88,250 | 17,891 | 20.3% |

귀속률: 직접배송 47.5%(257/671 라인) · 로켓 35.7%(브리지 외부옵션 25개) · 광고비 35.4%.

**이 수치는 귀속된 부분만의 공헌이익이다.** 미귀속 매출이 55.6M으로 귀속분보다 크므로
상품군 순위나 절대 금액을 그대로 경영 판단에 쓰면 안 된다. 귀속률을 올리려면
`InvLocationProductMap`에 로켓 외부코드 매핑을 늘리고 `ChannelProductAlias` 미매칭
417라인을 정리해야 한다.

### 캠페인↔상품 매핑 2단계 (dev DB 실측)

캠페인 `104902074` → `모달 머드팬티` 매핑을 시드하고 2026-06-01~18 구간을 재계산했다.

```
[before] adTotal=4,723,519 bridge=1,439,750 map=0         unalloc=3,283,769
[after ] adTotal=4,723,519 bridge=1,439,750 map=2,080,063 unalloc=1,203,706
Δ매핑귀속 = Δ미귀속감소 = 2,080,063 (일치) · 총광고비 보존
```

시드는 검증 후 삭제했다.

### 그 외

- 배분 산식 유닛 테스트 5건(팬아웃 금액 보존·비대칭 가중치·미매핑 미배분) 통과, `src/lib/sh` 스위트 123/123.
- `npx tsc --noEmit` 0 에러.
- prod에는 `AdCampaignProductMap` 마이그레이션이 아직 없다. 릴리스 시 `prisma migrate deploy`로 적용된다.
