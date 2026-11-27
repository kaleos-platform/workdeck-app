# 발주 추천 안정화 — velocity 도구 엔진 정합 + 모델 추천 임계값

작성: 2026-11-28 · 브랜치 `feat/reorder-recommend-stability` · 대상 develop

## 목표

1. MCP `sellerhub_get_option_sales_velocity` 의 생산 판단(모델·수량·상태)을 발주 엔진(위저드·`sellerhub_get_reorder_preview`)과 맞춘다.
   - 모델: 상품 설정 모델 우선, 없으면 **백테스트 추천**(지금은 MA_BLEND 고정).
   - 수량: 발주 단위 라운딩(필요량 < 단위/2 → 0, 아니면 단위 올림) + 직전 정산 bias. `suggestedProductionQty` = 엔진 비레이어드 수량.
   - 상태: 라운딩 후 수량이 0이면 PRODUCE_NOW/PRODUCE_SOON 이 아니다(→ OK). 재현 사례 BGE-S: velocity PRODUCE_NOW 1 vs 미리보기 0.
2. 위저드 첫 미리보기가 모니터링 화면에서 넘긴 보정계수(`initialDemandAdjust`)를 빠뜨리는 문제 수정(`reorder-plan-create.tsx:399`).
3. 추천 모델 불안정 완화(A안): 1위 모델 점수가 MA_BLEND 점수보다 **0.05(5%p) 이상 낮을 때만** 교체, 아니면 MA_BLEND.

범위 밖(에디 결정): 다구간 백테스트(B), 이전 추천 저장(C), 레이어드(로켓 몫) 분할을 velocity 에 넣는 것.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/inv/reorder-engine/backtest.ts` | `recommendModel` 에 `SWITCH_MARGIN = 0.05` 임계값 |
| `src/lib/inv/reorder-engine/__tests__/backtest.test.ts` | 임계값 테스트(근소차 → MA_BLEND, 5%p 이상 → 교체, MA_BLEND null → 최소값) |
| `src/lib/sh/option-velocity-query.ts` | 대상 상품을 `loadPlanOptionInputs` + `computeProductPlan`(layered=false) 로 계산해 모델·일률·수량을 받음. 상태는 라운딩 후 수량 기준 |
| `src/lib/sh/__tests__/option-velocity-*.test.ts` | 라운딩(BGE-S 형 0.5 → 0, OK)·추천 모델 일치·`suggestedProductionQty` = 엔진 값 테스트 |
| `src/lib/agent/tools/seller-hub-tools.ts` | velocity 도구 설명 갱신(“MA_BLEND·라운딩 없음” 문구 → 엔진 동일, 레이어드만 다름) |
| `src/components/sh/inventory/reorder-plan-create.tsx` | 첫 `fetchPreview` 에 `demandAdjustFactorOverride: initialDemandAdjust` 전달 |

## 단계

### 1. 임계값 (backtest.ts)
- 현재 `recommendModel` 은 최소 점수 모델(동점은 MODEL_ORDER 앞, MA_BLEND 1순위).
- 변경: `best !== 'MA_BLEND' && scores.MA_BLEND != null && scores.MA_BLEND - scores[best] < 0.05` 이면 MA_BLEND. 점수는 백테스트+정산 실적 평균(기존 그대로)에 적용.
- 반환 `scores` 는 그대로(화면의 모델 비교 표시 불변).
- 영향 경로: 발주 위저드·계획 생성·미리보기·에밀리 「발주 올려」(모두 `computeProductPlan`). 위저드의 “추천과 같은 선택이면 고정 해제”(`run-plan-request.ts:968`) 는 새 추천 기준으로 그대로 동작.

### 2. velocity 엔진 정합 (option-velocity-query.ts)
- 옵션 조회 후 등장 상품 id 집합 → `invProduct.findMany({ id in, options: deletedAt null & status ACTIVE (엔진과 동일), reorderRoundUnit, reorderConfig })`.
  - q·optionIds 필터로 일부 옵션만 보여도 백테스트는 **상품 전 옵션**으로 한다(엔진과 동일 결과의 전제).
- `loadPlanOptionInputs({ spaceId, products, now, rocketChannelId: null })` → `computeProductPlan({ product: { leadTimeDays: config ?? defaultProductionLeadTimeDays, targetCoverDays: targetCoverOverride ?? config ?? 30, roundUnit: reorderRoundUnit ?? 10, windowDays: config ?? 90, configModel, realized, layered: false }})`.
- 옵션 행에서 plan 결과가 있으면:
  - `forecastModel` = 상품 모델(config ?? recommended), `productionDailyRate` = plan.dailyRate(bias 전 — 미리보기 dailyForecast 와 같은 값), `suggestedProductionQty` = plan.finalQty(비레이어드, bias·라운딩 반영).
  - 신상품 옵션(이력 60일 미만, 엔진 MANUAL): 수량 = 엔진 그대로 0. 소진일상 생산이 필요해 보이면 상태 `NEW_OPTION`(“수동 수량 입력 필요”) — `onlyNeedsProduction` 에 포함, 권장량 합계 0. 일률은 엔진 siblingAvgRate.
  - 새 필드 `recommendedModel`, `roundUnit` 추가(에이전트가 근거를 볼 수 있게).
- 상태 판정 `judgeProductionStatus`: 소진일 계산은 그대로, `cover < lt` 라도 **라운딩 후 수량 0 이면 OK**(사유: “필요량 N개 < 발주 단위 절반 — 생산 권장 없음”).
- plan 결과가 없는 옵션(단종 옵션, 비활성 상품, 예측 제외 상품)은 기존 경로 유지(단종·제외는 수량 0, 비활성 상품은 기존 계산 + 라운딩만 적용).
- 생산 일률 창: 엔진과 같게 `analysisWindowDays ?? 90`(지금은 `max(periodDays, 창)` — periodDays > 90 이면 엔진과 달라짐). 표시 지표(salesQty·dailyVelocity) 는 periodDays 그대로.
- 로켓 이동 판단(replenishment)은 변경 없음.

### 3. 성능 영향
- 현재 velocity: 수요 1회(`max(2×periodDays, 90)`일, 스페이스 전체 채널 행), 재고 입력·순증감·반품 재고 각 1회.
- 추가: `loadPlanOptionInputs` 1회 = 수요 1회(90일, 스페이스 전체 — 가장 큼) + 재고 입력 + 순증감 + bias 1쿼리 + 정확도 1쿼리. 백테스트·모델 계산은 메모리(옵션당 5모델 × 90일, 수천 옵션도 수 ms).
- 즉 DB 읽기는 대략 **2배**(수요 로드가 지배적). 대신 velocity 자체 수요 창을 2×periodDays 로 줄이면(생산 일률을 엔진 입력에서 받음) 중복이 90일분 1회로 제한된다 → velocity 쪽 수요 창: `prevFrom`(기본 60일) 까지만. 단종·비활성 fallback 용 생산 일률은 엔진 입력이 없으므로, fallback 옵션이 있을 때만 기존 90일 창 유지.
  - ponytail: 중복 로드 1회 허용. 응답이 느려지면 `loadPlanOptionInputs` 에 미리 로드한 수요를 넘기는 인자 추가.
- 호출 빈도: 에밀리 주 1회 + 수동 질의. MCP 타임아웃(기존 도구 수 초 수준) 대비 문제 없을 것으로 보나, 운영 실측(배포 후 velocity 전체 조회 1회 응답 시간)을 검증에 포함.

### 4. 위저드 보정계수
- 399행 `fetchPreview(productId, false, [], {}, …)` → `{ demandAdjustFactorOverride: initialDemandAdjust }`(undefined 면 기존과 동일). state 클로저를 쓰지 않고 prop 을 직접 넘긴다.

### 5. 도구 설명
- “모델 미설정 상품은 백테스트 추천 대신 MA_BLEND, 발주 단위 라운딩·레이어드 분할 없음” → “발주 계획과 같은 모델(설정 우선, 없으면 백테스트 추천)·정산 보정·발주 단위 라운딩. 다른 점은 레이어드(로켓 몫) 분할 없음 — 위치 분배는 sellerhub_get_reorder_preview”.

## 검증
- 단위: backtest 임계값 3케이스, velocity — (a) 일률 0.01·재고 0·단위 10 → suggestedProductionQty 0, status OK (b) 모델 미설정 상품에서 velocity forecastModel = computeProductPlan recommendedModel (c) suggestedProductionQty = plan models[m].qty (bias 포함), 기존 production-window 테스트 갱신.
- `npx tsc --noEmit`, `npm run lint`, 관련 jest(`reorder-engine`, `option-velocity`, `reorder-plan-create`, `seller-hub-tools`).
- 배포 후(관리 세션): 운영 MCP 로 BGE-S velocity = 미리보기 0, 캡나시 velocity 모델 = 미리보기 모델, 전체 velocity 응답 시간.

## 운영 영향
- 추천 모델: 근소차 상품은 MA_BLEND 로 수렴(합성 시뮬 정상 수요 60일 뒤집힘 20→0회). 현재 SES_TREND·CROSTON·MA90 추천 상품 중 MA_BLEND 대비 5%p 미만 차이인 것이 MA_BLEND 로 바뀌며 발주 수량이 달라짐 — 실제 점수는 배포 전 볼 수 없어(미리보기 요약에 점수 없음) 배포 후 수납박스·머드팬티·캡나시 미리보기로 확인.
- velocity 생산 신호: 단위 절반 미만 필요 SKU 의 PRODUCE_NOW/SOON 이 OK 로 바뀜 → 에밀리 주간 보고 생산 후보 감소(의도).
- 설정 모델 고정 상품은 변화 없음.

## 롤백
- 단일 PR revert. 스키마·데이터 변경 없음. 임계값만 되돌리려면 `SWITCH_MARGIN = 0`.

## 범위 밖 메모
- 재고현황 등급(`src/lib/sh/queries.ts:582`)·발주 목록 카드(`app/api/sh/inventory/reorder/route.ts:142`)도 설정 없으면 MA_BLEND 고정 — 이번엔 velocity 만(에디 결정). 이후 velocity ↔ 재고현황 등급 일률이 모델 미설정 상품에서 달라질 수 있음.

## Codex 리뷰 반영 (adversarial-review, needs-attention, 4건 — 반영 2·부분 반영 1·보류 1)
1. [high] 신상품 수량 불일치 → **반영.** 위 2단계 신상품 항목(엔진 finalQty 0 + `NEW_OPTION` 상태) + 테스트.
2. [high] 전역 추천 변경을 실데이터 비교 없이 배포 → **부분 반영.**
   - 임계값 변경과 velocity 정합을 **별도 커밋**으로 나눠, 관리 세션이 임계값만 빼고 릴리스할 수 있게 한다.
   - 롤백 보강: 발주 계획은 초안이라 사람이 확정해야 발주로 이어진다. 배포 후 만든 계획은 `createdAt` 으로 식별해 확정 전 재검토. 이미 확정된 계획 수량은 자동 변경하지 않는다(revert 해도 영향 없음).
   - 보류: 배포 전 운영 실데이터 모델·수량 비교. 이 세션은 운영 DB 읽기 경로가 없고(직접 SQL 금지, `vercel env pull` 차단), 미리보기 MCP 는 점수를 주지 않는다. 대신 릴리스 게이트: main 반영 전후 운영 MCP 미리보기로 발주 대상 상위 상품(수납박스·머드팬티·캡나시·슬리퍼 등) 모델·totalOrderQty 를 대조해 관리 세션이 판단.
3. [high] MCP 지연 과소평가 → **부분 반영.**
   - `loadPlanOptionInputs` 의 상품별 `accuracyRows.filter`(상품 수 × 정산 행) → 옵션별 사전 그룹화(Map)로 바꿔 선형으로.
   - velocity 자체 수요 창을 표시 기간(2×periodDays)으로 줄이고, 생산 일률은 엔진 입력에서만 받는다(fallback 옵션 있을 때만 기존 창). 중복 로드는 엔진 90일 수요 1회.
   - 보류: 배포 전 운영 규모 p95 측정 — 운영 데이터 접근 없음(위와 같은 이유). 릴리스 후 관리 세션이 전체 조회 1회 응답 시간을 기존(11-27 실측 수 초)과 비교, 크게 느리면 revert.
4. [medium] 미리보기 vs 실제 생성 정산 경계 → **보류.** 미리보기(dryRun)가 정산을 안 하는 것은 기존 설계(위저드가 토글마다 호출해 write 금지)이며 velocity 도 미리보기와 같은 쪽에 맞춘다. 이번 목표(velocity=미리보기)와 별개 문제라 범위 밖.
