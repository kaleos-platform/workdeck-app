# 에밀리 주간 재고 분석 — MCP 툴 보정 + cron 도입 계획

- 작성: 2026-10-28
- 대상: 의식주의 Space, 에밀리(Hermes, `/Users/kaleos/aml`) + workdeck MCP `sellerhub_get_option_sales_velocity`
- 상태: 계획 확정(grill 세션) → §4 구현 완료(2026-10-29, 아래 §8 변경 이력)

## 1. 목표

에밀리가 workdeck MCP로 **주 1회 재고 분석 리포트**를 Slack에 게시하고, 스레드에서 후속 질의·발주 계획 요청을 받는다.

결정 대상(우선순위):

1. 생산 발주 판단 — 언제·얼마나 생산할지
2. 로켓그로스 이동 판단 — 사무실/3PL → 쿠팡 FC 이동량
3. 부록: 과잉 재고 — 정리 후보 식별

## 2. 점검 결과 (2026-10-28, origin/main `bbc56123`, prod 실호출)

### 정상

- MCP 인증·scope: `Claude 공용(의식주의)` 연동 계정에 `sellerhub:read/write`, seller-hub deck 활성.
- 에밀리: `config/hermes/config.yaml:438` 에 workdeck MCP 연결(`ads_approve_execution_task` 만 제외), 컨테이너 healthy. 세션 로그상 `sellerhub_get_option_sales_velocity`·`get_stock_status`·`get_product_options` 호출 이력 있음.
- 에밀리 cron 체계: `config/hermes/cron/jobs.json` + `cron-prompts/<name>.md` 패턴. 재고 관련 job 은 없음.

### 결함 (`src/lib/sh/option-velocity-query.ts`)

| # | 결함 | 근거 | 영향 |
|---|------|------|------|
| D1 | `channel="all"` 이 비판매 채널까지 수요로 집계 | `:181` `selectedChannels = activeChannels` — `ChannelTypeDef.isSalesChannel` 필터 없음. 실응답 채널에 `3PL 이동`·`로켓그로스 이동`·`협찬`·`기부`·`직원 구매`·`배송 송장 발급` 포함 | 내부 이동 이중계산 → `totalSuggestedProductionQty` 1,598 과대 |
| D2 | 상태 판정이 로켓그로스 전용 | `judgeReplenishmentStatus` `:66-77` 이 `rocketDailyVelocity` 만 봄 | 직배송·N배송·자사몰 전용 SKU 는 항상 `NO_SALES`(all 기준 103/135). 예: CHK-M 전채널 30일 76개·전사 소진 6.3일인데 생산 긴급성이 상태에 없음 |
| D3 | 리드타임 하나를 로켓 이동·생산에 공유 | `suggestReplenishQty`·`suggestProductionQty` 모두 `leadTimeDays`(기본 7) | 생산 리드타임(수 주)이 7일로 계산돼 생산 권장량 과소. 상품별 값 `InvReorderConfig.leadTimeDays` 가 이미 있는데 미사용 |
| D4 | 옵션별 재고가치 없음 | 응답 row 에 금액 필드 없음 | 과잉 재고를 금액 순으로 정렬 불가 |

## 3. 확정 결정

| # | 질문 | 결정 |
|---|------|------|
| Q1 | 분석이 내릴 결정 | 생산 + 로켓 이동 1순위, 과잉 재고는 부록 |
| Q2 | 실행 에이전트 | 정기 실행 + Slack 대화형 둘 다, **에밀리**가 담당 |
| Q3 | 정기 실행 주체 | 에밀리 cron 하나로 통일(Claude 루틴 별도 없음) |
| Q4 | 툴 결함 처리 | 툴 수정 후 cron 투입 |
| Q5 | 생산 리드타임 출처 | 상품별 `InvReorderConfig.leadTimeDays`, 미설정 시 기본 **20일 — 발주 화면·발주 계획·에이전트 발주·재고현황 등급과 공통**(§8) + `leadTimeSource` 표시 |
| Q6 | 에밀리 행동 범위 | 리포트만. 발주 계획은 스레드에서 사람이 요청할 때만 `sellerhub_create_reorder_plan`. 2~3주 운영 후 자동 제안 재검토 |
| Q7 | 주기·채널 | 주 1회 월 09:40 KST(cron `40 0 * * 1` UTC), Slack `C0A9CKY5NBG` |
| Q8 | 리포트 구성 | §5 형식. 과잉 기준 = 전사 소진 180일↑ 또는 판매 0 + 재고 보유 |
| Q9 | 배포 경로 | 워크트리 → develop → main(단계 분리). 운영 체크아웃 `workdeck-worker` 에서 개발 금지 |

## 4. 구현 — 툴 수정 (PR 1개)

파일: `src/lib/sh/option-velocity-query.ts`, `src/lib/agent/tools/seller-hub-tools.ts`(description), 테스트 `src/lib/sh/__tests__/option-velocity-calc.test.ts`.

원칙: **기존 응답 필드 의미 유지, 필드 추가만.** 로켓 상태(`replenishmentStatus`)는 그대로.

1. **D1 판매채널 필터** — `channel="all"` 을 `channelTypeDef.isSalesChannel = true` 채널로 제한.
   - `channelTypeDefId` 가 nullable — null 채널 처리 규칙을 판매분석 화면과 동일하게 맞춘다(구현 전 화면 쿼리 확인).
   - 이름 지정(`channel="<이름>"`)은 비판매 채널도 명시 조회 가능하게 유지.
   - 확인 필요: prod 에서 `협찬`·`기부`·`직원 구매` 가 실제 `isSalesChannel=false` 유형인지. 아니면 채널 유형 데이터 정정이 선행(코드 아님).
2. **D2 생산 상태 추가** — row 에 `productionStatus`(`PRODUCE_NOW`/`PRODUCE_SOON`/`OK`/`NO_SALES`) + `productionStatusReason`. 판정 = `daysOfCoverTotal`(입고예정 포함 여부는 기존 `suggestProductionQty` 와 일치시킴) vs 생산 리드타임. 임계값 초안: 소진일 ≤ 리드타임 → NOW, ≤ 리드타임+목표재고일 → SOON. `summary.productionStatusCounts` 추가.
3. **D3 생산 리드타임 분리** — 생산 계산은 상품별 `InvReorderConfig.leadTimeDays`, 없으면 30. row 에 `productionLeadTimeDays`·`leadTimeSource: 'config' | 'default'`. 기존 `leadTimeDays` 파라미터는 로켓 이동 전용으로 의미 축소(description 갱신). 선택 파라미터 `defaultProductionLeadTimeDays` 로 기본값 오버라이드.
4. **D4 재고가치** — row 에 `stockValue`(전사 가용 재고 × 단위원가 VAT 제외). 원가 규칙은 `sellerhub_get_product_options` 와 동일 함수 재사용.
5. **정렬 옵션** — `sortBy: 'urgency'(기본) | 'production' | 'stockValue'` 추가(과잉 재고 부록용). 불필요하면 생략하고 에밀리가 페이지 전체를 받아 정렬 — 135 SKU 라 1~2페이지.

테스트: D1 비판매 채널 제외, D2 직배송 전용 SKU 가 `PRODUCE_NOW` 로 뜨는 케이스, D3 config/default 분기, 기존 로켓 상태 회귀.

## 5. 에밀리 cron

`/Users/kaleos/aml/config/workspace/cron-prompts/inventory-weekly.md` (규칙서, 정기·수시 분석 공용)

호출 순서:

1. `sellerhub_get_option_sales_velocity` `channel="all"`, 전 페이지
2. `sellerhub_get_reorder_status` — DRAFT 계획 중복 표기용

리포트(Slack 1메시지, 상세는 스레드):

```
📦 주간 재고 분석 (기준일 MM/DD, 최근 30일 판매채널)
요약: 생산 필요 n SKU · 로켓 이동 필요 n SKU · 이동 불가(원재고 부족) n SKU

① 생산 발주 검토 (급한 순, 최대 10)
 상품/옵션 | 전사 소진일 vs 리드타임 | 권장 생산량 | 입고예정 | 기존 DRAFT 계획
② 로켓그로스 이동 (최대 10)
 상품/옵션 | 로켓 소진일 | 이동 권장(가능분) | 원재고
③ 부록: 과잉 재고 상위 5 (재고가치 순, 소진 180일↑ 또는 판매 0)
※ 판매량 GROSS(취소·반품 미차감) · 리드타임 기본값 적용 상품 n개
→ 발주 계획 올릴 상품은 스레드에 "발주 올려 <상품>"
```

규칙:

- 수치는 툴 응답값만 인용. 에밀리 자체 계산·추정 금지.
- `leadTimeSource=default` 상품은 표시.
- `sellerhub_create_reorder_plan` 은 스레드에서 사람이 명시 요청할 때만. 입력에 수량이 없으므로(승인 후 발주 화면 예측모델이 계산) memo 에 리포트 근거 수치 기록.

job: `inventory-weekly`, `40 0 * * 1`, deliver `slack:C0A9CKY5NBG`. **비활성으로 등록 → 1회 수동 실행 → 사용자 확인 후 활성화.** `jobs.json` 수정 전 백업(`jobs.json.bak.<date>-inventory-weekly`, 기존 관례).

## 6. 순서·검증

1. 워크트리 `workdeck-app-inventory-agent`(branch `feat/emily-inventory-analysis`, origin/develop 기준)에서 §4 구현 + 테스트, `npm run lint`·`npm run build`
2. PR → develop. main 릴리스는 별도 지시 후(워크트리→develop→main 정책)
3. prod 배포 후 MCP 직접 호출 검증
   - 응답 채널 목록에서 이동·협찬·기부 등 제거 확인
   - CHK-M(펠트 수납박스 M 초코브라운) `productionStatus=PRODUCE_NOW`
   - `totalSuggestedProductionQty` 변화 확인(1,598 → 이동분 제거·리드타임 반영 후 값), 상위 2~3 상품을 발주 계획 화면 수치와 대조
4. §5 cron-prompt 작성 → 비활성 등록 → 수동 1회 → 사용자 Slack 확인 → 활성화
5. 2~3주 운영 후 Q6 자동 제안 여부 재검토

## 7. 미결·리스크

- 생산 리드타임: 활성 상품 35개 중 33개 미설정 → 기본 20일 적용. 실제 값은 상품별 발주 설정에 입력 권장.
- 재고 음수 SKU 30개(교육몰 DIY 키트 부품 등) — 재고 기록 없이 출고. PRODUCE_NOW 상위를 차지하므로 리포트에서 별도 묶음으로 분리.
- 판매량 GROSS — 반품 많은 SKU(예: 반품등급 재고 큰 머드팬티)는 수요 과대. 툴 한계로 명시만.
- 에밀리 모델은 `gpt-5.6-terra` — 표 형식·수치 인용 정확도는 수동 1회 실행에서 확인.
- 비판매 채널 분류가 prod 데이터에서 틀려 있으면 D1 수정만으로 해결 안 됨(데이터 정정 선행).

## 8. 변경 이력 (구현 중 확정, 2026-10-29)

- **D1 정정**: 이동 채널(`로켓그로스 이동`·`3PL 이동`)은 주문 0건 — 이중계산 아님. 실제 비판매 수요는 `배송 송장 발급` 210·`협찬` 88·`기부` 1개/60일(prod). 채널 유형 분류는 이미 정확(데이터 정정 불필요), 타입 없는 활성 채널 0건.
- **필터 범위 확대(사용자 결정)**: 판매채널 필터를 velocity 툴뿐 아니라 수요를 읽는 5곳 공통으로 — 발주 화면(`reorder/route.ts`)·발주 계획 생성(`reorder/plan/route.ts`)·에이전트 발주 액션(`agent/actions/seller-hub.ts`)·예측 정확도(`forecast/accuracy.ts`). 헬퍼 `loadSalesDemandChannels`(`option-demand.ts`). accuracy 포함 근거: prod `ReorderPlan` 0건이라 진행 중 계획 편향 없음.
- **리드타임 기본 20일 공통(사용자 결정)**: `DEFAULT_PRODUCTION_LEAD_TIME_DAYS = 20`(`reorder-calculator.ts`) 하나로 발주 3곳 + 발주 설정 API 기본값 + 재고현황 등급 기본값(`stock-grade-settings.ts`, 의식주의는 저장값 없음 → 등급 이동). 로켓 이동 리드타임(7일)은 별개로 유지. 스키마 `@default(7)` 은 upsert 가 항상 값을 명시해 미사용 → 마이그레이션 없음.
- **추가 필드**: `negativeStockSkuCount`(summary), PRODUCE_NOW 사유에 재고 음수 표시, `sortBy`·`onlyNeedsProduction`.
- **prod 사전 검증(새 코드 직접 실행)**: 판매채널 21개, PRODUCE_NOW 29·SOON 4·OK 46·NO_SALES 55, CHK-M=PRODUCE_NOW(7.3일<20일), 재고가치 상위 선 클렌징 패드 벌크(소진 944일), 로켓 기본 모드 상태 수 변화 없음. 응답이 50KB 예산으로 ~54행에서 잘림 → 에밀리는 `nextCursor` 로 페이지 이어 받기.
