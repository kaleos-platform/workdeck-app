# 워크덱 도메인 용어집

결제·구독 도메인의 정식 용어. 코드·문서·대화에서 이 정의를 따른다.

## 결제·구독 (Billing)

- **Deck 구독**: deck 단위 월 구독 상품. 플랜 티어 없음 — 사용자는 쓰는 deck만 골라 구독한다. 결제는 Space당 단일 결제일에 합산 청구 1건.
- **과금 모드 (pricingMode)**: deck별 속성. `FREE_BETA`(무료 베타 — 전원 무료) 또는 `SUBSCRIPTION`(유료 — 구독 필요). 운영자가 deck 단위로 전환한다.
- **결제주체**: Space. 결제 관련 행위(카드 등록·구독·해지)는 Space OWNER 전용, ADMIN은 조회만.
- **Trial**: 유료 deck 첫 사용 시도 시 시작되는 14일 전 deck 개방 기간(lazy-start). Space당 평생 1회 — 이력이 있으면 재부여하지 않는다.
- **유예기간 (grace)**: deck이 FREE_BETA→SUBSCRIPTION으로 전환될 때, 전환 이전부터 그 deck을 쓰던 Space에 주어지는 14일. 만료 시 해당 deck만 잠긴다.
- **면제 (exempt)**: 운영자가 수동으로 부여하는 무기한 무료 플래그. Space 단위.
- **readonly (잠금)**: 구독 만료 상태의 deck 접근 수준 — 조회만 가능. export·쓰기·수집·에이전트 전부 차단. 잠금은 deck 단위이며 다른 deck에 영향 없다.
- **일할결제 (prorate)**: 주기 중간에 deck을 추가할 때 남은 일수만큼 즉시 결제하는 방식. "다음 주기부터 과금"의 무료 사용 루프를 차단한다.
- **dunning**: 정기결제 실패 후 재시도 절차. 결제일 +1·+3·+5일 3회, 그동안 접근 유지(PAST_DUE), 전부 실패 시 만료(EXPIRED).

## 테넌시

- **Space**: 멀티유저 테넌트이자 결제주체. deck 활성화(DeckInstance)·인가·신규 deck 데이터의 스코프.
- **Workspace**: 레거시 테넌트(쿠팡 수집 데이터 스코프). User와 1:1이며, Space와는 `User.id`를 통한 1:1 암묵 규칙으로만 연결된다. → [ADR-0002](docs/adr/0002-entitlement-space-axis.md)
- **DeckApp / DeckInstance**: 전역 deck 카탈로그 / Space에서 활성화된 deck. 과금 카탈로그(BillingDeckProduct)의 키는 DeckApp.id와 동일하다.
