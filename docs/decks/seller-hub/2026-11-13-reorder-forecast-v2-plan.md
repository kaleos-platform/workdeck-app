# 생산 발주 예측 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 생산 발주 수량을 "리드타임+목표 커버일수" 단일 공식으로 통일하고, 여러 수요 모델을 상품 단위로 비교·선택·채점하며, 외부 물류(위킵·쿠팡) 재고는 대조만을 기준으로 삼는다.

**Architecture:** 순수 함수 모듈 `src/lib/inv/reorder-engine/`(일별 시계열·품절일·모델·백테스트·발주량)을 새로 만들고, 발주 계획 라우트·MCP velocity·재고현황 등급이 모두 이것을 호출한다. 재고 입력(현재고·생산 중)은 `loadReorderStockInputs` 하나로 모은다. 생산 입고완료는 외부 물류 위치에 INBOUND를 쓰지 않고 `ProductionRun.externalStockIns`에 기록해 다음 대조 확정 전까지 '생산 중'으로 센다.

**Tech Stack:** Next.js 16 App Router, Prisma 7(PostgreSQL), Jest, shadcn/ui, Tailwind v4.

**Spec:** 이 문서의 「결정 사항」 절(2026-11-12~13 grill-me 확정). 배경 진단은 같은 절의 「진단」.

## 결정 사항 (spec)

진단(origin/main 2026-11-13):

- 발주 계획 `qty = ceil(dailyAvg×bias×lead + safety − (onHand+ORDERED))` — 목표 커버일수 없음(`app/api/sh/inventory/reorder/plan/route.ts` ~554).
- 발주 계획·MCP velocity(`src/lib/sh/option-velocity-query.ts` 139-153)·재고현황 등급(`src/components/sh/inventory/stock-status-view-model.ts` 48-82) 공식이 서로 다름.
- `buildDailySeries`가 오늘(부분일)을 포함하고 서버 로컬시간 키 사용(수요 키는 KST). 품절일 0을 그대로 셈. Holt-Winters는 1일 앞 예측(요일계수)×리드타임.
- 생산 중 = ORDERED만. 음수 재고가 권장량을 부풀림. 위킵 하자재고가 판매가능 재고에 섞임.
- 클라이언트가 위킵 대조 확정 1~2분 뒤 생산 차수 입고완료 → 외부 위치 재고 이중 계상(2026-11-12).

확정:

1. 공식: `발주량 = 일평균 × (리드타임 + 목표 커버일수) + 안전재고 − (현재고 + 생산 중)`, 상품별 목표 커버일수(기본 30). 발주 계획·MCP·재고현황 등급이 같은 함수 사용.
2. 모델 후보: `MA30`, `MA90`, `MA_BLEND`(30일 60% + 90일 40%), `SES_TREND`(지수평활+추세), `CROSTON`. 모두 어제(KST)까지 마감일만, 품절일 제외, '리드타임+커버일수' 기간 평균 일률.
3. 모델 선택은 **상품 단위**. 기본 추천 = 백테스트 오차 최소 모델. 사용자가 바꿀 수 있음.
4. 확정 시 모든 모델 예측 + 사용자 선택 모델 + 사용자 최종 수량을 저장 → 정산 때 모델별·`USER` 오차 채점 → 다음 추천 점수에 반영.
5. 재고 범위: 위킵 하자 제외(대조 수량 = 가용+유보, 하자는 별도 기록), PLANNED 생산 차수 포함, 음수 재고 0 처리 + '재고 확인 필요' 분리.
6. 생산 입고완료는 자체 물류 위치만 재고 반영. 외부 물류 위치(위킵 3PL·쿠팡)는 반영 안 함 — 그 위치의 다음 확정 대조 전까지 '생산 중'.
7. 상품별 '발주 예측 제외' 설정. 판매 이력 60일 미만 옵션은 같은 상품 기존 옵션 평균을 참고로 보여주고 수량은 사용자 입력.

## Global Constraints

- DB 스키마 변경은 `npx prisma migrate dev --name <작업명>`만. `db push`·prod 직접 SQL 금지.
- 날짜 키는 전부 KST `YYYY-MM-DD`(`src/lib/inv/option-demand.ts`의 `toKstDateKey`와 같은 규칙). "어제" = KST 기준 마감일.
- 모델 키 문자열: `'MA30' | 'MA90' | 'MA_BLEND' | 'SES_TREND' | 'CROSTON' | 'MANUAL'`. 정산 채점 키에는 추가로 `'USER'`.
- 기본값: 목표 커버일수 30, 리드타임 `DEFAULT_PRODUCTION_LEAD_TIME_DAYS`(20), 분석 기간 90, MA_BLEND 가중 0.6/0.4, 신상품 기준 60일, 외부 생산 중 최대 인정 30일.
- 외부 물류 위치 판정 = `type === 'THIRD_PARTY' || externalSource != null`.
- UI는 루트 `DESIGN.md` + `workdeck-ui` 스킬. 사용자 문구 한국어.
- 커밋: `✨ feat(sh): …` 형식, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add -A` 금지(변경 파일 명시).
- 릴리스: 브랜치 → PR(base=develop) → 머지 → main 격리 릴리스(origin/main 기준 cherry-pick).

## Review Focus

1. 판매가 전 기간 0이거나 전 기간 품절인 옵션 — 모든 모델이 0을 반환하고 NaN/Infinity가 없어야 한다(Task 1 테스트).
2. 이력 길이 < 백테스트 holdout(리드+커버)인 상품 — 추천은 `MA_BLEND`로 폴백, 오차는 `null`(Task 2 테스트).
3. 외부 위치 입고완료 후 대조가 영영 없을 때 — 30일 지나면 생산 중에서 빠진다(Task 4 테스트).
4. 레이어드(로켓+직접) 상품에서 로켓 비중 0 또는 1 — 분할 결과 합이 단일 계산과 같아야 한다(Task 7 테스트).
5. 자정(KST 00:00~09:00 UTC 전날) 실행 — 시계열 끝이 KST 어제여야 한다(Task 1 테스트, `now=2026-11-13T00:30:00+09:00`).

---

## File Structure

| 파일                                                                             | 책임                                |
| -------------------------------------------------------------------------------- | ----------------------------------- |
| `src/lib/inv/reorder-engine/series.ts` (신규)                                    | KST 마감일 시계열, 품절일 계산      |
| `src/lib/inv/reorder-engine/models.ts` (신규)                                    | 5개 모델 일률 계산                  |
| `src/lib/inv/reorder-engine/backtest.ts` (신규)                                  | 상품 단위 백테스트·추천 점수        |
| `src/lib/inv/reorder-engine/order-qty.ts` (신규)                                 | 발주량·커버일수 공식                |
| `src/lib/inv/reorder-engine/stock-inputs.ts` (신규)                              | 현재고·생산 중 로더, 외부 위치 판정 |
| `src/lib/inv/reorder-engine/index.ts` (신규)                                     | re-export                           |
| `prisma/schema.prisma`                                                           | 설정·저장 컬럼 추가                 |
| `app/api/sh/inventory/reorder/config/[productId]/route.ts`                       | 커버일수·제외·모델 설정             |
| `app/api/sh/production-runs/[runId]/transition/route.ts`                         | 외부 위치 INBOUND 생략              |
| `src/lib/inv/reconciliation-parser.ts`                                           | 하자 분리                           |
| `app/api/sh/inventory/reorder/plan/route.ts`                                     | 엔진 사용                           |
| `src/lib/inv/forecast/settle-accuracy.ts`, `accuracy.ts`                         | 모델별 채점                         |
| `src/lib/sh/option-velocity-query.ts`                                            | 엔진 사용, EXCLUDED                 |
| `src/components/sh/inventory/stock-status-view-model.ts` + 조회                  | 엔진 일률 사용                      |
| `src/components/sh/inventory/reorder-plan-create.tsx`, `reorder-plan-detail.tsx` | 모델 비교 UI                        |

---

### Task 1: 엔진 — 시계열·품절일·모델·발주량 (순수 함수)

**Files:**

- Create: `src/lib/inv/reorder-engine/series.ts`, `models.ts`, `order-qty.ts`, `index.ts`
- Test: `src/lib/inv/reorder-engine/__tests__/engine.test.ts`

**Interfaces:**

- Produces:
  - `type ModelKey = 'MA30' | 'MA90' | 'MA_BLEND' | 'SES_TREND' | 'CROSTON'`
  - `type DayPoint = { date: string; qty: number; stockout: boolean }`
  - `kstYesterday(now: Date): string`
  - `buildClosedSeries(qtyByDate: Record<string, number>, windowDays: number, now: Date, stockoutDates?: Set<string>): DayPoint[]` — 마지막 원소 = `kstYesterday(now)`
  - `stockoutDates(input: { currentStock: number; netByDate: Record<string, number>; salesByDate: Record<string, number>; dates: string[] }): Set<string>` — 일 시작 재고 ≤ 0 이고 그날 판매 0인 날. 일 시작 재고 = currentStock − Σ(그날 이후 포함 net).
  - `forecastRates(series: DayPoint[], horizonDays: number): Record<ModelKey, number>` — 품절일 제외 후 일률(≥0). 유효일 0이면 전부 0.
  - `computeOrderQty(i: { dailyRate: number; leadTimeDays: number; targetCoverDays: number; safetyStockQty: number; onHandQty: number; incomingQty: number; roundUnit: number }): { gross: number; suggestedQty: number; roundedQty: number; checkStock: boolean; coverDays: number | null }` — `onHandQty<0`이면 0으로 쓰고 `checkStock=true`. `coverDays = (max(onHand,0)+incoming−safety)/dailyRate`, rate 0이면 null.

- [ ] **Step 1: 실패 테스트 작성** — `engine.test.ts`:
  - `kstYesterday(new Date('2026-11-12T15:30:00Z'))` → `'2026-11-12'` (KST 11-13 00:30)
  - `buildClosedSeries({'2026-11-12':3}, 3, new Date('2026-11-13T03:00:00Z'))` → dates `['2026-11-10','2026-11-11','2026-11-12']`, qty `[0,0,3]`
  - 품절일: currentStock 0, net `{ '2026-11-12': -5 }`, sales `{ '2026-11-12': 5 }`, dates 11-10..11-12 → `{'2026-11-10','2026-11-11'}` 아님 확인: 11-12 시작재고 5 → 비품절, 11-11 시작재고 5, 11-10 시작재고 5 → 빈 Set. 다른 케이스: currentStock 0, net 없음, sales 없음 → 3일 모두 품절.
  - `forecastRates`: 90일 매일 2개 → 모든 모델 `toBeCloseTo(2, 1)`; 전부 0 → 전부 0; 전부 품절 → 전부 0, `Number.isFinite` 확인; 최근 30일 4개·이전 60일 1개 → `MA30=4`, `MA90=2`, `MA_BLEND=0.6*4+0.4*2=3.2`.
  - `computeOrderQty({dailyRate:2, leadTimeDays:20, targetCoverDays:30, safetyStockQty:10, onHandQty:40, incomingQty:0, roundUnit:10})` → `gross=100, suggestedQty=70, roundedQty=70`; `onHandQty:-30` → `checkStock=true`, `suggestedQty=110`.
- [ ] **Step 2: 실행해 실패 확인** — `npx jest src/lib/inv/reorder-engine` → FAIL(모듈 없음)
- [ ] **Step 3: 구현** — 모델 정의: MA30/MA90 = 최근 30/90 유효일 평균(유효일 = 비품절일, 창 안에서). `SES_TREND` = Holt 선형(α=0.3, β=0.1, 계절 없음)으로 horizon 일 예측 합 ÷ horizon. `CROSTON` = `src/lib/inv/forecast/croston.ts`의 `forecastCroston` 재사용(품절일 제외한 `DailyOutbound[]` 전달). KST 날짜는 `option-demand.ts`의 방식(+9h UTC 슬라이스)과 동일하게 구현.
- [ ] **Step 4: 통과 확인** — `npx jest src/lib/inv/reorder-engine` → PASS
- [ ] **Step 5: 커밋** — `✨ feat(sh): 발주 엔진 — KST 마감 시계열·품절일·5개 모델·발주량 공식`

### Task 2: 엔진 — 백테스트·추천

**Files:**

- Create: `src/lib/inv/reorder-engine/backtest.ts`
- Test: `src/lib/inv/reorder-engine/__tests__/backtest.test.ts`

**Interfaces:**

- Consumes: Task 1 `DayPoint`, `forecastRates`, `ModelKey`
- Produces:
  - `backtestProduct(optionSeries: DayPoint[][], horizonDays: number): Record<ModelKey, number | null>` — 각 옵션 시계열 끝 `horizonDays`일을 holdout, 앞부분으로 `forecastRates` → 예측합 vs 실제합. 상품 WAPE = Σ|예측−실제| ÷ Σ실제(Σ실제 0이면 null). 학습 구간이 30일 미만이면 전 모델 null.
  - `recommendModel(backtest: Record<ModelKey, number | null>, realized?: Partial<Record<ModelKey | 'USER', number>>): { model: ModelKey; scores: Record<ModelKey, number | null> }` — 점수 = 백테스트와 실적(있으면) 평균, 최소 점수 모델. 전부 null이면 `MA_BLEND`.

- [ ] **Step 1: 실패 테스트** — 120일 시계열(앞 60일 1개/일, 뒤 60일 3개/일), horizon 30 → `MA30` 오차 < `MA90` 오차, `recommendModel` → `'MA30'` 또는 `'SES_TREND'`(둘 중 최소; 테스트는 `scores.MA90 > scores.MA30` 단정). 길이 40·horizon 30 → 전부 null, 추천 `MA_BLEND`. realized `{MA90: 0}` 주면 MA90 점수 = (백테스트+0)/2.
- [ ] **Step 2: 실패 확인** — `npx jest src/lib/inv/reorder-engine/__tests__/backtest.test.ts`
- [ ] **Step 3: 구현** — 위 시그니처대로.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `✨ feat(sh): 발주 엔진 — 상품 단위 백테스트·모델 추천`

### Task 3: 스키마 + 상품 발주 설정 API

**Files:**

- Modify: `prisma/schema.prisma` (InvReorderConfig 1722, ReorderForecastModel 127, ReorderPlanItem 3605, ReorderPlanAccuracy 3653, ProductionRun 2213)
- Modify: `app/api/sh/inventory/reorder/config/[productId]/route.ts`
- Test: `app/api/sh/inventory/reorder/config/__tests__/route.test.ts` (없으면 생성, 기존 라우트 테스트의 `resolveDeckContext`·prisma mock 패턴 따름)

**Interfaces:**

- Produces (Prisma):
  - `InvReorderConfig.targetCoverDays Int @default(30)`, `excludeFromForecast Boolean @default(false)`, `forecastModel String?`
  - `ReorderForecastModel` 값 추가: `MA30 MA90 MA_BLEND SES_TREND`
  - `ReorderPlanItem.modelForecasts Json?` — `{ [ModelKey]: dailyRate }` + `selected: ModelKey|'MANUAL'`
  - `ReorderPlanAccuracy.modelWape Json?` — `{ [ModelKey|'USER']: number }`
  - `ProductionRun.externalStockIns Json?` — `Array<{ optionId: string; locationId: string; quantity: number }>`
- Produces (API): GET 응답에 `targetCoverDays`, `excludeFromForecast`, `forecastModel` 추가(설정 없으면 30/false/null). PATCH가 세 필드를 받음(`targetCoverDays` 1~365 정수, `forecastModel`은 ModelKey 또는 null).

- [ ] **Step 1: 실패 테스트** — PATCH `{targetCoverDays: 45, excludeFromForecast: true, forecastModel: 'MA90'}` → upsert 인자에 세 값; `targetCoverDays: 0` → 400; `forecastModel: 'XX'` → 400; GET 기본값 30/false/null.
- [ ] **Step 2: 실패 확인** — `npx jest app/api/sh/inventory/reorder/config`
- [ ] **Step 3: 스키마 수정 후 `npx prisma migrate dev --name reorder_forecast_v2`**, 라우트 수정
- [ ] **Step 4: 통과 확인** + `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — 마이그레이션 디렉터리·schema·route·test 명시 add. `✨ feat(sh): 발주 설정 — 목표 커버일수·예측 제외·모델 선택 컬럼`

### Task 4: 재고 입력 로더 (현재고·생산 중)

**Files:**

- Create: `src/lib/inv/reorder-engine/stock-inputs.ts`
- Modify: `src/lib/inv/planned-stock.ts` (PLANNED 포함, 외부 대기분 합산 함수 추가)
- Test: `src/lib/inv/reorder-engine/__tests__/stock-inputs.test.ts`, `src/lib/inv/__tests__/planned-stock.test.ts`(기존 갱신)

**Interfaces:**

- Consumes: Task 3 `ProductionRun.externalStockIns`
- Produces:
  - `isExternalLogisticsLocation(loc: { type: string; externalSource: string | null }): boolean`
  - `INCOMING_PRODUCTION_STATUSES = ['PLANNED', 'ORDERED'] as const` (기존 `INCOMING_PRODUCTION_STATUS` 대체, 사용처 전부 갱신)
  - `pendingExternalQtyByOption(runs: Array<{ stockedInAt: Date | null; externalStockIns: unknown }>, lastConfirmedReconAtByLocation: Map<string, Date>, now: Date): Map<string, number>` — 위치의 확정 대조 시각이 `stockedInAt` 이후면 제외, `stockedInAt`이 30일 이전이면 제외.
  - `loadReorderStockInputs(spaceId: string, optionIds: string[], now?: Date): Promise<Map<string, { onHandQty: number; rocketOnHandQty: number; incomingQty: number; returnGradeQty: number }>>` — onHand = Σ`invStockLevel` − 쿠팡 반품등급(`src/lib/inv/coupang-return-stock.ts` 기존 함수 재사용, 기존 plan/route.ts 388-401 로직 이동). incoming = PLANNED+ORDERED items + `pendingExternalQtyByOption`. 확정 대조 시각 = `InvReconciliation` status `CONFIRMED|APPLIED`의 `confirmedAt ?? createdAt` 최댓값(위치별).

- [ ] **Step 1: 실패 테스트** — `pendingExternalQtyByOption`: stockedInAt 11-12 10:58, 위치 A 확정 대조 11-12 10:56 → 대기분 포함; 11-13 확정 → 제외; stockedInAt 40일 전 → 제외. `isExternalLogisticsLocation({type:'OWN', externalSource:'coupang_rocket_growth'})` → true. PLANNED run 수량이 incoming에 포함.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx jest src/lib/inv/reorder-engine src/lib/inv/__tests__/planned-stock.test.ts`
- [ ] **Step 5: 커밋** — `✨ feat(sh): 발주 재고 입력 — 계획 차수·외부 물류 입고 대기분 포함`

### Task 5: 생산 입고완료 — 외부 물류 위치는 재고 미반영

**Files:**

- Modify: `app/api/sh/production-runs/[runId]/transition/route.ts:80-215`
- Modify: 입고 위치 선택 UI(전환 다이얼로그 — `grep -rn "transition" src/components/sh/production*`로 찾는 컴포넌트) 안내 문구
- Test: 기존 transition 테스트 파일에 케이스 추가(`app/api/sh/production-runs/[runId]/transition/__tests__/`; 없으면 생성)

**Interfaces:**

- Consumes: Task 4 `isExternalLogisticsLocation`, Task 3 `externalStockIns`
- Produces: STOCKED_IN 전환 시 allocations 를 외부/자체로 분리. 자체 → 기존 `applyBatchInbound`. 외부 → INBOUND 없음, `productionRun.externalStockIns`에 저장. `stockedInQty`는 두 쪽 합.

- [ ] **Step 1: 실패 테스트** — 위치 2개(OWN 사무실, THIRD_PARTY 위킵)로 분배 → `applyBatchInbound` 인자에 사무실 행만, update 데이터에 `externalStockIns: [{optionId, locationId: 위킵, quantity}]`, `stockedInQty` = 합계.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** + UI 문구: 외부 위치 선택 시 "외부 물류 위치는 입고완료로 재고가 늘지 않습니다. 다음 재고 대조에서 반영되고, 그 전까지는 생산 중으로 계산됩니다."
- [ ] **Step 4: 통과 확인** — `npx jest app/api/sh/production-runs`
- [ ] **Step 5: 커밋** — `🐛 fix(sh): 외부 물류 위치 생산 입고는 재고 미반영(대조 기준) — 이중 계상 방지`

### Task 6: 위킵 대조 — 하자재고 분리

**Files:**

- Modify: `src/lib/inv/reconciliation-parser.ts:5-20, 223-250`
- Modify: `src/components/sh/inventory/reconciliation-preview.tsx` (파일 수량 옆 `하자 N` 표시, 0이면 숨김)
- Test: `src/lib/inv/__tests__/reconciliation-parser*.test.ts`(기존 inventory_list 케이스 갱신)

**Interfaces:**

- Produces: `ParsedRow.defectQuantity?: number`. `inventory_list`: `quantity = 가용+유보`, `defectQuantity = 하자`. matchResults JSON 에 그대로 실려 기록됨(스키마 변경 없음).

- [ ] **Step 1: 실패 테스트** — 가용 5·유보 1·하자 2 → `quantity 6`, `defectQuantity 2`.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현** → **Step 4: 통과**(`npx jest src/lib/inv/__tests__ -t inventory_list`)
- [ ] **Step 5: 커밋** — `✨ feat(sh): 위킵 재고 대조 — 하자재고는 판매가능 재고에서 분리`

### Task 7: 발주 계획 라우트 — 엔진 적용

**Files:**

- Modify: `app/api/sh/inventory/reorder/plan/route.ts` (수요 시계열 ~436-475, 재고 358-426, 수량 533-557, 레이어드 641-661, 저장부)
- Modify: `src/lib/inv/set-plan-calc.ts` `computeLayeredRoundedSplit` 입력을 gross 기반으로(시그니처 유지, 호출부가 horizon gross 전달)
- Test: `app/api/sh/inventory/reorder/plan/__tests__/` 기존 테스트 갱신 + `src/lib/inv/__tests__/set-plan-calc.test.ts`

**Interfaces:**

- Consumes: Task 1~4 전부, Task 3 config 필드
- Produces (POST body 추가): `modelByProduct?: Record<string, ModelKey | 'MANUAL'>`, `manualQtyByOption?: Record<string, number>`
- Produces (응답 item 추가): `models: Record<ModelKey, { dailyRate: number; qty: number }>`, `backtestWape: Record<ModelKey, number|null>`(상품 공통), `recommendedModel: ModelKey`, `selectedModel: ModelKey|'MANUAL'`, `targetCoverDays: number`, `checkStock: boolean`, `isNewOption: boolean`, `siblingAvgRate: number | null`
- 동작:
  - `excludeFromForecast` 상품은 목록·생성에서 제외.
  - 시계열 = `buildClosedSeries`(창 = `analysisWindowDays`) + `stockoutDates`(InvMovement 일별 net 전 위치 합 + 현재고).
  - horizon = lead + targetCoverDays. 상품 단위 `backtestProduct` → `recommendModel`(realized = 최근 정산 3건의 `modelWape` 평균).
  - 선택 = `modelByProduct[productId] ?? config.forecastModel ?? recommended`. 이력 < 60일 옵션은 `MANUAL`, `siblingAvgRate` = 같은 상품 이력≥60일 옵션의 선택 모델 일률 평균, 수량 = `manualQtyByOption[optionId] ?? 0`.
  - 수량 = `computeOrderQty` (bias 보정은 dailyRate에 곱하는 기존 방식 유지). 레이어드: 로켓 gross = gross × 로켓 비중(창 내 로켓 판매 ÷ 전체, 전체 0이면 0).
  - 비 dryRun 생성 시 `modelForecasts` 저장, `InvReorderConfig.forecastModel` = 선택 모델 upsert, `forecastModel` enum 컬럼 = 선택 모델(MANUAL 포함).

- [ ] **Step 1: 실패 테스트** — (a) 커버일수 반영: rate 2, lead 20, cover 30, 재고 40, safety 10 → 70. (b) `excludeFromForecast` 상품 미포함. (c) 레이어드 로켓 비중 0 → 로켓분 0, 합 = 단일 계산. (d) 이력 30일 옵션 → `selectedModel 'MANUAL'`, `siblingAvgRate` 값. (e) `modelByProduct`로 MA90 지정 시 그 일률 사용.
- [ ] **Step 2: 실패 확인** — `npx jest app/api/sh/inventory/reorder src/lib/inv/__tests__/set-plan-calc.test.ts`
- [ ] **Step 3: 구현** — 기존 `forecastOption`/`buildDailySeries` 호출 제거(모듈은 accuracy·monitor가 쓰면 유지).
- [ ] **Step 4: 통과 확인** + `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `✨ feat(sh): 발주 계획 — 커버일수 공식·모델 비교·상품 단위 선택`

### Task 8: 정산 — 모델별·사용자 선택 채점

**Files:**

- Modify: `src/lib/inv/forecast/accuracy.ts`, `src/lib/inv/forecast/settle-accuracy.ts`
- Test: `src/lib/inv/forecast/__tests__/` 기존 정산 테스트 갱신

**Interfaces:**

- Consumes: Task 3 `modelForecasts`, `modelWape`
- Produces: 정산 시 `modelWape[k] = |rate_k × lead − actual| / actual` (actual 0이면 키 생략), `USER` = `(confirmedFinalQty + confirmedStock − safety) / (lead+cover)`의 일률로 같은 식. 기존 `wape`/`bias` 계산은 그대로.
- 평가 기간: 기존 `[confirmedAt, confirmedAt+lead]` 유지(커버 기간까지 늘리지 않음 — 정산이 늦어지는 것 방지).

- [ ] **Step 1: 실패 테스트** — modelForecasts `{MA30: 2, MA90: 1}`, lead 10, actual 20 → `modelWape {MA30: 0, MA90: 0.5}`; modelForecasts 없는 구 계획 → `modelWape` null.
- [ ] **Step 2~4** — `npx jest src/lib/inv/forecast`
- [ ] **Step 5: 커밋** — `✨ feat(sh): 발주 정산 — 모델별·사용자 선택 적중 오차 기록`

### Task 9: MCP velocity·재고현황 등급 — 엔진 공식 사용

**Files:**

- Modify: `src/lib/sh/option-velocity-query.ts` (139-161 공식, 244-245 일률, 342-414 재고)
- Modify: `src/components/sh/inventory/stock-status-view-model.ts:48-82` + 그 입력을 만드는 조회(`queries.ts` 359-385, `grep -rn "out30d" src/lib src/components`로 위치 확인)
- Test: `src/lib/sh/__tests__/option-velocity-query*.test.ts`, `src/components/sh/inventory/__tests__/stock-status-view-model*.test.ts`

**Interfaces:**

- Consumes: Task 1 `forecastRates`/`computeOrderQty`, Task 4 `loadReorderStockInputs`, Task 3 config
- Produces:
  - velocity: `suggestedProductionQty = computeOrderQty(...)`.suggestedQty, 일률 = 상품 `forecastModel ?? 'MA_BLEND'`의 일률(시계열은 `periodDays` 창). `productionStatus`에 `'EXCLUDED'` 추가(설정 제외 상품, 권장량 0). `thirdPartyQty` 집계에 `isExternalLogisticsLocation` 사용(쿠팡 제외 외부 = 3PL). `targetCoverDays` 기본은 상품 설정값. MCP 도구 description(`src/lib/agent/tools/seller-hub-tools.ts`)의 공식 문구 갱신.
  - 재고현황 등급: 일평균 = 같은 엔진 `MA_BLEND`(또는 상품 선택 모델), 판매 수요 기준(`loadOptionDemand`)으로 변경. 등급 임계는 기존 설정 유지.

- [ ] **Step 1: 실패 테스트** — velocity: rate 2·lead 20·cover 30·가용 40·safety 10 → 권장 70(라운딩 없음). 제외 상품 → `EXCLUDED`, 권장 0. 등급: 같은 입력에서 커버일수가 velocity `daysOfCoverWithIncoming`과 같음.
- [ ] **Step 2~4** — `npx jest src/lib/sh src/components/sh/inventory/__tests__`
- [ ] **Step 5: 커밋** — `♻️ refactor(sh): MCP·재고현황 등급이 발주 엔진 공식 사용`

### Task 10: 발주 화면 — 모델 비교·선택, 설정

**Files:**

- Modify: `src/components/sh/inventory/reorder-plan-create.tsx` (Step ④ `STEP_CALC`), `reorder-plan-types.ts`, `reorder-plan-detail.tsx`
- Modify: 상품 발주 설정 UI(`grep -rn "reorder/config" src/components`)
- Test: `src/components/sh/inventory/__tests__/reorder-plan-create*.test.tsx` (기존 있으면 갱신)

**Interfaces:**

- Consumes: Task 7 응답 필드·body 필드, Task 3 config API
- UI:
  - Step ④에 상품별 "예측 모델" 표: 행 = 모델(이동평균 30일 / 90일 / 혼합 / 지수평활+추세 / 간헐 수요), 열 = 일평균, 발주량 합계, 과거 오차(%), 선택 라디오. 추천 모델에 「추천」 배지. 바꾸면 dryRun 재호출(`modelByProduct`).
  - 목표 커버일수 입력(상품별, 기본 설정값) — 변경 시 config PATCH + 재계산.
  - 신상품 옵션 행: 수량 입력칸 + "같은 상품 평균 하루 N개" 참고 문구.
  - `checkStock` 옵션: 「재고 확인 필요」 경고 배지(권장량에 음수 재고 미반영 안내).
  - 상세 화면: 옵션별 선택 모델명, 모델별 일률 툴팁.
  - 상품 설정: 「발주 예측 제외」 스위치, 목표 커버일수.

- [ ] **Step 1: 실패 테스트** — 모델 라디오 변경 시 fetch body에 `modelByProduct: {p1: 'MA90'}`; 추천 배지 렌더; 신상품 수량 입력이 `manualQtyByOption`으로 전송.
- [ ] **Step 2~4** — `npx jest src/components/sh/inventory`
- [ ] **Step 5: 브라우저 확인** — `npm run dev` 후 발주 계획 생성 Step ④ 스크린샷(로컬 QA 계정, 메모리 `reference_local_dev_qa_login`)
- [ ] **Step 6: 커밋** — `✨ feat(sh): 발주 위저드 — 모델 비교표·커버일수·신상품 수동 수량`

### Task 11: 검증·릴리스·운영 데이터

- [ ] **Step 1:** `npx tsc --noEmit`, `npm run lint`, `npx jest src/lib/inv src/lib/sh app/api/sh src/components/sh` (기존부터 실패하던 스위트는 pristine과 대조해 구분)
- [ ] **Step 2:** `.env.local` 물려 `npm run build`
- [ ] **Step 3:** PR(base=develop) → CI 통과 → 머지 → origin/main 기준 cherry-pick 격리 릴리스 → prod 배포 success 확인(마이그레이션 적용 확인 포함)
- [ ] **Step 4: 운영 데이터** (사용자 확인 후): 위치 「위킵 (크림드)」·「위킵 (에이엠엘)」 type → `THIRD_PARTY`(위치 관리 화면). 와펜·DIY 키트·스트랩·부자재 상품 「발주 예측 제외」 켜기(대상 목록은 사용자 승인).
- [ ] **Step 5: prod 검증** — MCP `sellerhub_get_option_sales_velocity channel=all`: 음수재고 SKU 권장량 0+CHECK_STOCK, 머드 누드 S 권장량이 리드+커버 공식과 일치. 발주 계획 dryRun에서 모델 비교표 확인.
- [ ] **Step 6:** 에밀리 재시작(MCP 스키마 재로드, 메모리 `reference_emily_mcp_tool_cache`)
