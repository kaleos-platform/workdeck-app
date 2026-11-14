# 업무별 체험·면제 Implementation Plan

> **For agentic workers:** Use executing-plans for backend integration, then a focused UI implementer and spec/code review. 공유 파일 변경은 순차 진행한다.

**Goal:** 업무별 최초 7일 체험·관리자 연장·면제와 별도 구독 현황 페이지를 제공한다.

**Architecture:** SpaceDeckAccess의 Space × 업무 유일 레코드로 이용 정책을 관리한다. SpaceSubscription의 결제일·결제수단·합산 청구는 유지하고, 기존 전체 면제는 우선 적용한다.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, React, shadcn/ui, React Hook Form/Zod, Jest.

## 1. 스키마·권한·청구 (주 agent)

- [x] `src/lib/billing/__tests__/entitlement.test.ts`에 독립 업무 정책 입력의 체험·면제 격리 테스트를 먼저 추가하고 실패 확인.
- [x] `prisma/schema.prisma`에 SpaceDeckAccess 모델/FK/유일 제약 추가. `prisma migrate dev --name deck_trial_access`로 생성, RLS·최소 권한·기존 설치 업무 체험 백필 포함.
- [x] `src/lib/billing/entitlement-core.ts`, `entitlement.ts`에서 업무 정책을 조회·판정. `ensureTrialStarted(spaceId, deckAppId)`를 원자적 최초 생성으로 변경.
- [x] `app/api/spaces/decks/route.ts`에서 설치와 체험 시작 transaction 연결. 서버 정책 판단에 따른 체험 소비 방지.
- [x] `subscription-service.ts`에서 면제된 업무 신규·추가 청구 거절, 정기청구 제외, 무료 주기 처리와 카드 삭제 검사를 적용.
- [x] Jest 실행: `npm test -- src/lib/billing --runInBand`. 업무별 체험·면제 회귀가 통과해야 한다.

## 2. 관리자 조회·변경 API (주 agent)

- [x] API 인가·입력·날짜·경합·감사 실패 테스트를 먼저 작성해 실패 확인.
- [x] `src/lib/validations/admin-subscriptions.ts`: 날짜·사유·상호배타적 변경 Zod schema. 미래 일자와 기존 체험보다 이후 날짜만 허용.
- [x] `app/api/admin/subscriptions/route.ts`: 운영자 조회와 Space·소유자·업무·이용정책·구독 상태를 합성.
- [x] `app/api/admin/subscriptions/[spaceId]/[deckAppId]/route.ts`: transaction으로 정책 변경/감사 기록. 체험 연장은 결제일·유료 상태를 바꾸지 않는다. 면제 전환은 유료 아이템 종료·보장가 보존.
- [x] `src/lib/billing/subscription-admin.ts`와 공유 응답 타입으로 데이터 접근을 화면과 분리.

## 3. 구독 현황 분리·사용자 안내 (UI implementer)

- [x] 목록/검색/필터·체험 연장·면제 경로를 컴포넌트 테스트로 먼저 고정.
- [x] `/admin/subscriptions`와 메뉴 추가. `/admin/billing`에서 기존 구독 표·관련 state 제거.
- [x] Space·소유자·업무·상태·체험 종료·다음 결제·면제·조작 열. table-fixed·고정 식별 열과 390px 가로 스크롤 대응.
- [x] 체험 연장 dialog는 날짜/+7/+30/사유 필수. 자동 결제가 아님을 안내하고 서버 에러 유지. 업무별/공간 전체 면제를 구분.
- [x] 사용자 구독 화면은 업무별 체험 날짜·면제 표시로 전환.

## 4. 통합 검증·리뷰 (주 agent와 reviewer)

- [x] 실제 별도 로컬 PostgreSQL에서 migration·백필·체험/청구 e2e를 검증한다. PG는 mock, 운영 DB는 접근하지 않는다.
- [x] `npm test -- <changed-tests> --runInBand`, `npm run typecheck`, `npm run lint`, `npm run build`.
- [x] spec 충족·금전/권한/경합 리뷰와 코드 품질 리뷰 후 필요한 수정.
- [x] 변경 파일·테스트·migration·문서만 커밋하고 worktree와 검증 한계를 보고한다.

## 실행·검증 기록

- 작업 브랜치: `feat/admin-deck-trials`, 최신 develop 기준 별도 worktree.
- DB: 전용 로컬 PostgreSQL `127.0.0.1:55471/deck_trials`와 별도 shadow만 사용했다. 원격 개발·운영 DB는 변경하지 않았다. 기존 전체 migration은 빈 DB에서 재생되지 않아 현재 기준 schema로 로컬 baseline을 구성하고, `prisma migrate dev --name deck_trial_access --create-only`로 차이를 생성한 뒤 RLS·백필을 포함해 `migrate dev`로 적용했다. 기존 migration 이력은 수정하지 않았다.
- 신규 DB 회귀: 동시 최초 체험, 업무 간 격리, 면제 청구 제외, 결제 준비 중 면제 재확인, 연장·감사 원자성, 실제 DB rollback, 면제 해제 소급청구 방지, PENDING 차단.
- 실제 migration SQL은 격리 schema에서 백필 범위·만료 이력·전체 면제 보존과 RLS·Data API 권한 회수를 검증했다.
- 기존 구독·보장가 e2e는 현재 카탈로그 가격을 기준으로 검증하도록 오래된 하드코딩 금액을 정정했다. 토스 provider는 전부 mock이다.
- 독립 리뷰에서 미구독 업무의 결제일 오표시와 테스트 회귀를 수정하고 재검토에서 추가 P1/P2 finding 없음.
- 관련 단위·UI·API·migration lint 110개, DB e2e 39개, CLI 6개를 검증한다. CLI는 기준 제품의 mode/isActive를 snapshot·복원해 초기 DB 상태에 의존하지 않는다.
- `npm run typecheck`, `npm run lint`, `npm run build` 통과. 전체 lint는 기존 warning 65개, error 0개.
- 실 로그인 브라우저 검증·운영 배포는 이번 로컬 검증에 포함하지 않았다.
