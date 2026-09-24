# 초기 마케팅비 생산차수 원가 반영 설계

## 1. 배경과 목표

현재 가격 시뮬레이션은 채널별 목표 ROAS로 판매 1건의 광고비를 계산한다. 이 방식은 판매량에 비례하는 성과형 광고비에는 적합하지만, 상품 출시 시점에 한 번 발생하는 리뷰·체험단·인플루언서 비용의 성격과는 맞지 않다.

초기 마케팅비를 특정 생산 차수의 대상 상품에 귀속하고, 실제 입고수량에 나누어 상품 단위 원가에 반영한다. 가격 시뮬레이션에서는 생산원가와 초기 마케팅비를 별도로 보여주되, 마진과 권장 판매가 계산에는 두 비용의 합계를 사용한다.

## 2. 범위

### 포함

- 생산 차수 원가 항목에 `MARKETING` 분류 추가
- 마케팅 원가 항목의 대상 상품 지정
- 실제 입고수량 기준 상품별 배분과 누적 가중평균
- 상품 옵션 관리와 가격 시뮬레이션의 원가 구성 표시
- 저장 snapshot에 생산원가·초기 마케팅비 구성 보관
- 기존 생산 차수와 가격 시나리오의 하위 호환

### 제외

- 채널별 목표 ROAS 광고비 계산 방식 변경
- 상품 옵션별 서로 다른 마케팅비 배분율
- 리뷰·체험단·인플루언서 등 마케팅 하위 분류 enum
- 재고 lot별 원가, FIFO/LIFO, 현재 잔존 재고 기준 가중평균
- 생산 차수와 무관한 상시 마케팅비 관리

## 3. 데이터 모델과 불변식

`ProductionCostCategory`에 `MARKETING`을 추가하고, `ProductionRunCost`에 nullable `targetProductId`와 `InvProduct` FK, index를 추가한다.

```prisma
targetProductId String?
targetProduct   InvProduct? @relation(fields: [targetProductId], references: [id], onDelete: Restrict)

@@index([targetProductId])
```

- `category = MARKETING`이면 `targetProductId`가 필수다.
- 대상 상품은 해당 생산 차수의 옵션 목록에 포함되어야 한다.
- `category != MARKETING`이면 `targetProductId`는 `null`로 정규화한다.
- 상품 삭제는 FK `Restrict`로 막고, 생산 차수 삭제 시 비용 항목은 기존처럼 `Cascade`로 삭제한다.
- 상품명·브랜드·옵션 속성 수정은 ID 연결에 영향을 주지 않는다.

기존 비용 행은 기존 category와 `targetProductId = null`을 그대로 사용하므로 데이터 백필은 필요하지 않다. DB 변경은 `npx prisma migrate dev --name add_production_marketing_cost`로 생성한다.

## 4. 원가 배분 규칙

### 4.1 유효 수량

`STOCKED_IN` 생산 차수만 원가 연동에 포함한다.

```text
effectiveQty = stockedInQty ?? quantity
```

`stockedInQty = 0`은 실제 입고 0개로 인정하고, `null`인 구 데이터만 발주수량을 사용한다.

### 4.2 차수별 배분

입고 완료 차수 `r`과 상품 `p`에 대해:

```text
runQty(r) = Σ effectiveQty(차수 r의 전체 옵션)
productQty(r, p) = Σ effectiveQty(차수 r의 상품 p 옵션)

productionCost(r) = Σ exVat(amount), category != MARKETING
marketingCost(r, p) = Σ exVat(amount), category = MARKETING and targetProductId = p

allocatedProductionCost(r, p)
  = productionCost(r) × productQty(r, p) / runQty(r)
```

일반 생산비는 차수 전체 입고수량에 균등 배분하고, 마케팅비는 지정한 상품에만 귀속한다. `runQty(r) = 0` 또는 `productQty(r, p) = 0`인 차수는 계산에서 제외하고 관리 화면에서 경고한다.

### 4.3 상품별 누적 가중평균

상품 `p`를 포함한 유효 입고 차수 집합을 `R(p)`라 하면:

```text
totalProductQty(p) = Σ productQty(r, p), r ∈ R(p)

productionUnitCost(p)
  = Σ allocatedProductionCost(r, p) / totalProductQty(p)

marketingUnitCost(p)
  = Σ marketingCost(r, p) / totalProductQty(p)

totalUnitCost(p)
  = productionUnitCost(p) + marketingUnitCost(p)
```

초기 1,000개에 마케팅비 3,000,000원이 들고 후속 1,000개에는 마케팅비가 없으면 `marketingUnitCost`는 3,000원에서 1,500원으로 누적 가중평균된다. 같은 상품의 옵션은 모두 같은 상품 단위 원가 구성을 사용한다.

## 5. 서버 구조와 API

원가 배분은 순수 계산 모듈로 분리하고 상품별로 다음 값을 반환한다.

```ts
type ProductUnitCostBreakdown = {
  productionUnitCost: number
  marketingUnitCost: number
  totalUnitCost: number
  runCount: number
}
```

생산 차수 `POST`/`PATCH` API는 UI와 독립적으로 다음을 검증한다.

- 마케팅 항목의 대상 상품 누락
- 대상 상품이 생산 차수의 옵션 목록에 없음
- 다른 Space의 상품 ID 주입
- 생산 차수 옵션 수정 후 기존 마케팅 항목의 대상이 사라짐

검증 실패 시 `400`과 구체적인 한국어 메시지를 반환한다. 대상이 사라진 비용을 다른 상품에 자동 재배분하지 않는다.

상품 옵션 조회 API는 기존 `effectiveCostPrice`와 원가 구성을 함께 반환한다. 수동 원가는 전체를 `productionUnitCost`로 간주하고 `marketingUnitCost = 0`으로 다룬다.

## 6. UI 설계

### 6.1 생산 차수 입력

- `총원가 직접 입력`과 `세부 항목 입력` 모두에 `비용 분류`를 노출한다.
- 분류는 `원자재`, `인건비/봉제`, `포장`, `물류`, `마케팅`, `기타`로 표시한다.
- `마케팅`을 선택한 행에만 `대상 상품`을 노출한다.
- 단일 상품 차수는 대상을 자동 선택하고 읽기 전용으로 표시한다.
- 다상품 차수는 저장 전 대상 상품을 반드시 선택한다.
- 대상 상품의 모든 옵션을 차수에서 제거하면 해당 행을 오류 상태로 표시하고 저장을 막는다.
- 합계 영역에 `생산비`, `초기 마케팅비`, `총 반영 원가`를 표시한다.

### 6.2 상품 옵션 관리

- `공급원가`는 두 구성의 합계를 그대로 표시한다.
- `생산차수 원가 연동` 요약과 공급원가 tooltip에 `생산원가 평균 + 초기 마케팅비 평균 = 공급원가`를 표시한다.
- 상품이 `INACTIVE`로 변경되어도 기존 원가 기록은 유지한다.

### 6.3 가격 시뮬레이션

- 상품 선택 행의 총원가는 유지하고 상세에서 생산원가와 초기 마케팅비를 나눈다.
- 비용 구성 막대에 `생산원가`와 `초기 마케팅비` segment를 따로 표시한다.
- 계산 엔진의 총 `cogs`, 순이익, 마진, 권장 판매가는 두 원가의 합계를 사용한다.
- 채널별 ROAS 광고비는 별도 판매비용으로 유지한다. 사용자가 두 항목을 모두 입력한 경우 성격이 다른 비용으로 보아 모두 합산한다.

## 7. 가격 시나리오 snapshot 호환

`ResolvedComponent`에 다음 optional field를 추가한다.

```ts
productionUnitCost?: number
marketingUnitCost?: number
```

`costPrice`는 기존처럼 합계이며 마진 계산의 공식적 입력으로 유지한다. 신규 snapshot은 구성값을 함께 저장해 원가 변경 후에도 저장 당시 결과를 복원한다.

기존 snapshot에 구성 필드가 없으면 `productionUnitCost = costPrice`, `marketingUnitCost = 0`으로 해석한다. snapshot version은 올리지 않고 optional field로 하위 호환을 유지한다.

계산 엔진에는 구성별 COGS를 추가하되 합계 `cogs`는 기존 contract로 유지한다. 구 입력은 전체 `cogs`를 생산원가로 간주한다.

## 8. 오류 처리

- 대상 상품이 없는 마케팅 행: 행 단위 inline error, 저장 비활성화
- 생산 차수 수정 중 대상 상품 제거: 항목 삭제 또는 대상 재지정 전까지 저장 차단
- 다른 Space 또는 차수에 없는 상품 ID: API `400`
- 0개 입고 차수: 가중평균에서 제외하고 관리 화면에 경고
- 연결된 상품 삭제: `409` 삭제 차단 응답

## 9. 테스트 전략

### 단위 테스트

- 단일 상품 차수의 생산비·마케팅비 배분
- 다상품 차수에서 마케팅비가 대상 상품에만 귀속됨
- `stockedInQty` 우선, `null`일 때만 `quantity` fallback, 0개 처리
- 항목별 VAT 포함/미포함 ex-VAT 변환
- 후속 생산 후 생산원가·마케팅비 누적 가중평균
- 구 snapshot의 원가 구성 fallback
- 원가 구성 분리 전·후의 총원가, 권장 판매가, 마진 동일성

### API·UI 테스트

- 정상 마케팅 항목 생성·수정·복원
- 대상 누락, 다른 Space, 차수에 없는 상품 거부
- 대상 상품의 모든 옵션 제거 후 저장 거부
- 단일 상품 자동 선택과 다상품 필수 선택
- 생산비·마케팅비·총원가 합계
- 가격 시뮬레이션 비용 구성 segment 표시

### 수동 검증

- 생산 차수 등록 → 입고완료 → 상품 옵션 공급원가 구성 → 가격 시뮬레이션 비용 구성 end-to-end 확인
- 단일·다상품 생산 차수와 기존 저장 시나리오 확인
- desktop/mobile 폭에서 원가 입력 표와 비용 구성 표시 확인

## 10. 완료 기준

- 초기 마케팅비가 생산 차수의 특정 상품에만 귀속된다.
- 실제 입고수량 기준 단위 원가와 후속 생산 후 누적 가중평균이 정확하다.
- 상품 옵션과 가격 시뮬레이션에서 생산원가와 초기 마케팅비를 구분할 수 있다.
- 원가 구성을 나눈 후에도 합계, 권장 판매가, 마진은 기존 계산과 일치한다.
- 유효하지 않은 대상이 다른 상품으로 자동 재배분되지 않는다.
- 기존 생산 원가 행과 가격 시나리오가 수정 없이 정상 조회·복원된다.
- 관련 Jest 테스트, `npm run typecheck`, `npm run lint`, `npm run build`가 통과한다.
