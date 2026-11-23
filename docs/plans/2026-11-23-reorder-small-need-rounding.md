# 발주 엔진 — 작은 필요량은 발주 단위로 올리지 않기

## 배경 (2026-11-23 에밀리 주간 보고)

- 펠트 수납박스 S 베이지(BGE-S): 50일 기대 수요 1.5개, 재고 0 → 필요 2 → 발주 단위 10으로 올림 → 10개 발주.
- 펠트 수납박스 M 초코브라운(CHK-M): 위킵 94개(86.7일분). 90일 판매 77개 중 로켓 판매는 2개라 로켓 몫 필요량이 약 2개(로켓 재고 0). 이게 레이어드 분할에서 10으로 올라감.
  - 8/7 `c810c058` 규칙(일반 위치 재고로 로켓 부족분을 상쇄하지 않음)은 유지한다(에디 결정).
  - 로켓 2개는 기존 「로켓 이동」 권장(velocity `suggestedReplenishQty`)으로 처리한다.

## 결정 (에디 2026-11-23)

필요량(라운딩 전)이 발주 단위의 절반 미만이면 0. 그 이상이면 지금처럼 발주 단위로 올린다.

- 단위 10: 1~4 → 0, 5~10 → 10, 11~20 → 20. 0이 되는 건 「필요량 < 단위/2」인 경우만이다.
- 단위 1: 영향 없음(필요량은 정수 ≥1).
- 이미 단위보다 큰 필요량(예 12)은 지금처럼 올림(20). 이번 변경은 「작은 필요량이 0 → 10으로 튀는」 것만 막는다.

## 변경 파일

1. `src/lib/sh/set-plan-calc.ts`
   - `roundUpQty`: `qty < unit / 2` 이면 0.
   - `computeLayeredRoundedSplit`: `linkedLocationQty` 는 지금처럼 연동 필요량 그대로 둔다(finalQty 로 자르지 않음).
     finalQty 0 + 연동 몫 2 는 「사용자가 최종수량을 연동 몫보다 낮춘」 기존 경우와 같다. 소비처가 이미 `min(최종, 연동 몫)` 으로 처리한다:
     linked SKU budget(`run-plan-request.ts` 5.65), stockin-split baseline, 미리보기 요약 linkedQty. 위저드에서 0→10 으로 올리면 연동 몫 2가 그대로 살아난다.
2. `src/lib/inv/reorder-engine/order-qty.ts`
   - `roundedQty` 를 같은 규칙으로. 공용 함수 하나(`roundToOrderUnit`)를 `order-qty.ts`에 두고 `set-plan-calc.ts`가 가져다 쓴다.
   - `suggestedQty`(라운딩 전)는 그대로 — `option-velocity-query.ts`(MCP `suggestedProductionQty`)와 `app/api/sh/inventory/reorder/route.ts`는 `suggestedQty`·`gross`만 써서 영향 없음.
3. 테스트: `src/lib/sh/__tests__/set-plan-calc.test.ts`, `src/lib/inv/reorder-engine/__tests__/engine.test.ts`
   - 단위 10, 필요 2 → 0 / 필요 5 → 10 / 필요 12 → 20.
   - 레이어드: 로켓 필요 2, 나머지 0 → finalQty 0, linkedLocationQty 2(유지), remainingQty 0.
   - 기존 8/7 회귀 테스트(43 vs 50 → 50) 유지 확인.

`run-plan-request.ts` `ownLayerFields`는 라운딩 전 필요량(ownNeedQty)을 보여 주므로 변경 없음. 수동 수량(MANUAL)·위저드 override 는 라운딩 안 하므로 영향 없음.

## 위험

- 재고 0이고 필요량 4(단위 10)인 옵션이 0이 돼 결품 가능. 에디가 감수하기로 함 — 저판매 옵션 과발주 방지 우선. 위저드에서 수동으로 올릴 수 있다.
- 백테스트/모델 비교 표의 모델별 qty도 같은 규칙으로 바뀜(같은 함수 경로).

## 검증

- `npx jest src/lib/sh/__tests__/set-plan-calc.test.ts src/lib/inv/reorder-engine` 통과.
- `npx tsc --noEmit`, `npm run lint`.
- 배포 후 MCP `sellerhub_get_reorder_preview`(수납박스 `cmorvht4q000004jr29nycq7n`) — CHK-M·BGE-S 가 options 에서 빠지고 noOrderOptionCount 가 늘어나는지.

## 롤백

커밋 revert 한 번(스키마·데이터 변경 없음). 배포 후 만든 발주 계획은 revert 해도 그대로 남는다.

- 발주 계획은 사람이 위저드에서 옵션별 수량을 확인·수정하고 만드는 초안이고, 생산 차수로 넘어가기 전까지 수량을 고칠 수 있다.
- 롤백이 필요하면 배포 시각 이후 `ReorderPlan.createdAt` 계획을 찾아, 생산 전 계획은 다시 만들고 생산에 들어간 건 에디가 확인한다.

## Codex 리뷰 반영 (2026-11-23, 지적 2건)

- [high] 연동 몫을 finalQty 로 자르면 0→수동 증량 시 로켓 몫이 복구 안 됨 → 반영: 자르지 않음(위 1번).
- [medium] revert 로 저장 계획 복구 불가 → 반영: 롤백 절차 추가. 배포 전 운영 데이터 영향 비교는 보류 — 운영 DB 접근이 이 세션에서 막혀 있어 배포 후 MCP 미리보기로 확인한다.
