# ADR-0002: entitlement는 Space 축 단일, Workspace 수집 게이트는 User 1:1 역참조

- 상태: 승인 (2026-07-28)
- 관련: 결제 시스템 Phase 1, coupang-ads 수집 파이프라인

## 결정

결제 entitlement 판정의 유일한 축은 **Space**다(SpaceSubscription.spaceId). coupang-ads 수집처럼 **Workspace** 스코프인 자원의 결제 게이트는 `Workspace.ownerId → User → 최고참 Space 멤버십` 역참조(`canWorkspaceCollect`)로 Space 판정에 위임한다.

## 배경 (미래 독자가 놀랄 지점)

테넌시가 이원화되어 있다: 쿠팡 수집 데이터·큐(CollectionRun, CoupangCredential)는 레거시 `Workspace`(User와 1:1, ownerId unique) 스코프이고, deck 활성화·인가·신규 deck 데이터는 `Space` 스코프다. 두 축을 잇는 FK는 없고, `resolveWorkspace()`가 쓰는 "같은 User가 소유" 암묵 규칙뿐이다.

## 검토한 대안

- **Workspace에도 entitlement 저장(이중화)**: 동기화 드리프트 위험 — 기각.
- **Workspace→Space FK 신설**: 올바른 방향이지만 결제 범위를 넘는 마이그레이션. 점진 전환 완료 시 별도 과제.

## 선택 이유

판정 로직이 한 곳(entitlement.ts)에 있어야 정책 변경(유예·면제 등)이 한 번에 적용된다. 역참조는 기존 `resolveSpaceContext`와 동일 기준(최고참 멤버십)을 사용해 일관성을 유지한다.

## 결과

- 수집 차단은 이중 게이트: run 생성(`/api/collection/runs` POST 402) + 워커 폴링 필터(`runs/pending`).
- Workspace가 여러 Space와 연결되는 구조로 바뀌면 `canWorkspaceCollect`의 최고참 멤버십 가정을 재검토해야 한다.

## 후속

- 레거시 Workspace의 Space 통합 완료 시 이 역참조 제거
