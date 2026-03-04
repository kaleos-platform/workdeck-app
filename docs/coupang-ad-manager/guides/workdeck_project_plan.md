# Workdeck 프로젝트 확장 계획

기준일: 2026-02-27

## 1. 목표 요약

- 기존 `coupang-ad-manager`의 인증 체계를 유지하며 Workdeck 상위 구조로 확장한다.
- 사용자 구조를 `계정 -> 공간(개인/조직) -> Deck(하위 프로젝트)`로 표준화한다.
- 하위 프로젝트 간 통신은 반드시 **동일 공간(Space) 내부에서만** 허용한다.
- 도메인 역할을 분리한다.
  - `app.workdeck.work`: 실제 서비스 앱(로그인, My deck, Deck 실행)
  - `workdeck.work`: 홈페이지/Deck 랜딩/마케팅 블로그

## 2. 현재 상태 분석

- 인증은 Supabase Auth 기반으로 안정적으로 동작 중이다.
- 현재 데이터 모델과 API는 `User 1 : 1 Workspace` 구조를 강하게 전제한다.
- 대부분의 API/페이지가 `workspaceId` 단일 컨텍스트를 기준으로 구현되어 있다.
- 확장 핵심은 인증 교체가 아니라 테넌트/권한/컨텍스트 모델 전환이다.

## 3. 목표 아키텍처 (MVP)

### 3.1 계정/공간/Deck 모델

- `User`: Supabase Auth 사용자
- `Space`: 개인 공간 또는 조직 공간
- `SpaceMember`: 공간 멤버십 + 역할 (`OWNER | ADMIN | MEMBER`)
- `DeckApp`: Deck 앱 메타 (`coupang-ad-manager`, `b2b-content-manager`, ...)
- `DeckInstance`: 특정 Space에서 활성화된 Deck 인스턴스

### 3.2 라우팅/도메인 정책

- 앱 도메인: `https://app.workdeck.work`
  - `/my-deck`
  - `/space/[spaceId]`
  - `/d/[deckKey]`
- 홈페이지 도메인: `https://workdeck.work`
  - `/` 제품 소개
  - `/deck/[deckKey]` Deck별 랜딩
  - `/blog/[slug]` 마케팅 블로그

## 4. Deck 간 통신 설계 (보안 고정 정책 포함)

### 4.1 원칙

- 하위 프로젝트 간 통신은 **same-space only** 정책을 적용한다.
- 송신 DeckInstance와 수신 DeckInstance의 `spaceId`가 다르면 통신을 차단한다.
- 클라이언트가 전달한 `spaceId`는 신뢰하지 않고 서버에서 재계산한다.

### 4.2 서버 강제 검증

통신 처리 시 아래 순서를 강제한다.

1. 사용자 인증
2. source/target DeckInstance 조회
3. `spaceId` 동일성 검증 (`assertSameSpace`)
4. 사용자 역할 검증 (`OWNER`, `ADMIN`, `MEMBER`)
5. 데이터 교환 정책 검증
6. 처리 결과 감사 로그 저장

### 4.3 권한 정책

- 정책/연동 설정 변경: `OWNER`, `ADMIN`만 허용
- 일반 실행/조회: `MEMBER`는 제한된 범위에서만 허용
- cross-space 통신 시도는 즉시 `403` 반환 + 보안 로그 기록

### 4.4 감사/추적

- 모든 통신 요청에 다음 필드를 기록한다.
  - `actorUserId`
  - `sourceDeckInstanceId`
  - `targetDeckInstanceId`
  - `resolvedSpaceId`
  - `result(allow|deny)`
  - `reason`

## 5. 데이터 교환 구조 (MVP)

### 5.1 방식

- 직접 DB 조인 중심의 강결합을 피하고 공통 교환 계층을 사용한다.
- MVP는 저비용으로 시작한다.
  - Shared Facts 테이블
  - 서버 API
  - 필요 시 Outbox 기반 비동기 처리 추가

### 5.2 예시 시나리오

- 가격관리 Deck가 `ProductMarginFact`를 발행한다.
- 광고관리 Deck가 같은 `spaceId` 내 데이터만 조회한다.
- `실마진 ROAS`, `순이익 기반 성과`를 계산해 대시보드에 노출한다.

## 6. 인터페이스/API 변경 계획

- 공통 컨텍스트:
  - `resolveWorkspace()` -> `resolveDeckContext(deckKey)` 전환
- 신규 API (예시):
  - `GET /api/spaces`
  - `GET /api/spaces/:spaceId/decks`
  - `POST /api/spaces/:spaceId/decks/:deckKey/activate`
  - `POST /api/data-exchange/:targetDeck/dispatch`
  - `GET /api/data-exchange/policies`
  - `POST /api/data-exchange/policies`
- 제약:
  - 요청 바디의 `spaceId` 직접 입력 금지
  - 서버 계산 `spaceId`만 사용

## 7. 단계별 실행 계획

### Phase 0. 도메인/운영 정리

- `app.workdeck.work`를 제품 앱으로 고정한다.
- `workdeck.work`를 홈페이지/마케팅 채널로 고정한다.

### Phase 1. 데이터 모델 확장

- `Space`, `SpaceMember`, `DeckApp`, `DeckInstance` 추가
- `DataExchangePolicy`, `DataExchangeAudit` 추가
- 기존 사용자/워크스페이스를 개인 Space + `coupang-ad-manager` DeckInstance로 백필

### Phase 2. 권한/컨텍스트 전환

- `resolveDeckContext()` 도입
- 기존 API를 점진 전환
- `assertSameSpace()`를 통신 공통 가드로 적용

### Phase 3. My deck 구현

- 공간(개인/조직)별 Deck 목록 제공
- Deck 선택 시 `/d/[deckKey]` 진입

### Phase 4. Deck 간 통신 MVP

- 가격관리 -> 광고관리 연동 구현
- 마진율 기반 광고 성과 계산 반영

### Phase 5. 홈페이지/콘텐츠 체계

- `workdeck.work`에 Deck 랜딩/블로그 운영
- `b2b-content-manager` PRD/ROADMAP을 `docs/` 내에서 관리

## 8. 테스트 및 검증 시나리오

1. 같은 Space Deck 간 통신 성공
2. 다른 Space 간 통신 차단(403)
3. 요청 바디 위변조(`spaceId` 조작) 방어
4. 역할별 권한 검증 (`OWNER/ADMIN/MEMBER`)
5. 기존 `coupang-ad-manager` 핵심 플로우 회귀 검증
6. 감사 로그 기록/조회 정상 동작

## 9. 장단점

### 장점

- 기존 인증 체계 재사용으로 개발 속도와 비용 효율이 높다.
- Space 경계 보안이 명확해 데이터 유출 리스크를 낮춘다.
- Deck 확장 및 상호연동 기반을 MVP부터 확보할 수 있다.

### 단점

- 기존 `Workspace`와 신규 모델 병행 기간의 복잡도가 증가한다.
- 권한/감사 로직 추가로 초기 구현량이 늘어난다.
- 도메인 2개 운영으로 배포/분석 관리 포인트가 증가한다.

## 10. 기본 가정

- 배포는 초기 비용 최소화를 위해 단일 앱 중심으로 운영한다.
- 권한 모델은 `OWNER | ADMIN | MEMBER`를 사용한다.
- Deck URL은 `/d/[deckKey]`를 사용한다.
- Deck 간 통신은 동일 Space 내에서만 허용한다.
