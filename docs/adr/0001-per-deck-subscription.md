# ADR-0001: deck별 구독 + deck별 과금 모드 (플랜 티어 기각)

- 상태: 승인 (2026-07-28)
- 관련: 결제 시스템 Phase 1

## 결정

과금 모델을 **deck별 개별 구독**으로 한다. 각 deck이 구독 상품이며(BillingDeckProduct), Space는 쓰는 deck만 골라 구독하고 단일 결제일에 합산 청구된다(SpaceSubscription + SubscriptionItem 라인아이템). 각 deck은 `pricingMode`(FREE_BETA | SUBSCRIPTION)를 가지며, 출시 시 전 deck FREE_BETA로 시작해 운영자가 deck 단위로 유료 전환한다.

## 동인

1. "필요한 업무만 골라 쓴다"는 워크덱 제품 컨셉과 과금 단위의 일치
2. deck별 원가·가치 차이(워커 크롤링 deck vs 경량 deck)를 가격에 직접 반영
3. 무료 베타로 먼저 배포하고 준비된 deck부터 점진 과금하는 저위험 롤아웃

## 검토한 대안

- **플랜 티어(Free/Pro/Business)**: 가격표는 단순하나 deck 구성이 고정돼 "안 쓰는 deck에 지불" 문제. 인터뷰 과정에서 티어+등급, 티어+애드온 하이브리드까지 검토 후 최종 기각.
- **티어 + 애드온 하이브리드**: 계단은 완만하지만 개념 이중화(티어·등급·애드온)로 가격표 설명 비용 증가.
- **사용량(GB) 과금**: 사용자가 자기 데이터량을 예측 불가 → 기각. 데이터 차등이 필요해지면 보관기간(retention) 방식으로 후속.

## 선택 이유

라인아이템 모델(SubscriptionItem.type=DECK)은 세 요구(단순·합리·점진 전환)를 모두 만족하면서, 추후 애드온(type=ADDON)·번들 상품을 스키마 변경 없이 수용한다.

## 결과

- 중도 deck 추가는 일할 즉시결제(무료 사용 루프 차단), 해제는 기간말까지 사용.
- 유료 전환 시 기존 사용 Space는 14일 유예 후 해당 deck만 잠금(조회만).
- Trial은 유료 deck 첫 사용 시도 시 lazy-start 14일, Space당 평생 1회.
- 가격·모드는 전부 DB 데이터(BillingDeckProduct) — 변경에 배포 불필요.

## 후속

- Phase 2: AI 사용량 크레딧(선불 충전), 애드온(type=ADDON) 상품화
- 세금계산서/현금영수증 발행(Phase 1 범위 외 — 토스 매출전표로 대체)
