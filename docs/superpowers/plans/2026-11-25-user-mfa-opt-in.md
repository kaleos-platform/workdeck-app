# 일반 사용자 2단계 인증 기본 꺼짐 + 계정 단위 켜기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 사용자의 `requireAal2` 게이트를 기본으로 풀고, `User.mfaRequired`가 켜진 계정만 지금처럼 인증 앱을 요구한다. 어드민에서 켜고 끄며 목록에서 사용 현황을 본다.

**Architecture:** `User.mfaRequired` 컬럼 하나. `requireAal2()` 내부에서 세션 claims 의 `sub` 로 사용자를 읽어 `mfaRequired=false` 이고 운영자가 아니면 통과. 평문 비밀값으로 이어질 수 있는 에이전트·비밀값 권한 경로는 `requireAal2({ ignoreUserFlag: true })` 로 계정 플래그와 무관하게 계속 인증 앱을 요구. 운영자 게이트(`requireOperator`)·`requireFreshAal2`는 손대지 않는다. 어드민 토글은 ban 패턴 + 감사 로그 같은 transaction.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Supabase Auth(`getClaims`), jest.

**Spec:** `docs/superpowers/specs/2026-11-25-user-mfa-opt-in-design.md`

## Global Constraints

- 스키마 변경은 `npx prisma migrate dev --name user_mfa_required` 만. `db push`·운영 DB 직접 SQL 금지.
- `requireOperator`(`src/lib/admin/auth.ts`)·`requireFreshAal2`(`src/lib/auth/mfa.ts`) 동작 변경 금지.
- 비상 스위치 `ADMIN_REQUIRE_MFA=false` 는 지금처럼 `requireAal2`를 먼저 연다.
- 플래그 변경 경로는 `requireOperator` 뒤 어드민 API 하나뿐. 일반 사용자 API·폼에서 `mfaRequired` 를 받지 않는다.
- 운영자(`platformRole = OPERATOR`)는 플래그와 무관하게 `requireAal2` 에서 항상 인증 앱 요구(게이트에서 판정 — 이후 `grant-operator.mjs` 로 승격된 계정도 자동 적용). 어드민에서 운영자 플래그 변경은 400.
- 계정 플래그와 무관하게 항상 인증 앱 요구(`ignoreUserFlag`)하는 경로: 에이전트 생성 `POST agents`, 에이전트 수정 `PATCH agents/[agentId]`(scopes·ACTIVE·oauthClientId), 토큰 발급 `POST agents/[agentId]/tokens`, 비밀값 저장·허용 에이전트 변경 `PUT·DELETE secrets/[name]`, 승인 한도 변경 `approval-limit`(최종 리뷰 반영). 이유: AAL1 ADMIN 이 비밀값 허용 에이전트에 토큰을 발급해 `/api/secrets/env` 로 평문을 받는 우회 차단(Codex 지적 1).
- 화면 문구: 칸 이름 「2단계 인증」, 값 「필수」/「꺼짐」, 등록 표시 「인증 앱 등록」/「미등록」, 구독 현황 칸 「인증 필수 구성원」.

## Review Focus

- 세션 claims 를 못 읽는 경우(만료·오류) → 통과가 아니라 기존 aal2 판정으로 떨어져 403(닫힘 실패). Task 2 테스트로 고정.
- DB 에 User 행이 없는 세션(가입 직후 등) → 플래그 false 로 취급해 통과. Task 2 테스트.
- 플래그 켠 직후 → 다음 요청부터 즉시 게이트 적용(캐시 없음). Task 2 는 매 호출 조회.
- 마이그레이션 뒤 운영자로 승격된 계정(`mfaRequired=false`) → `requireAal2` 403. Task 2 테스트.
- 인증 앱이 꺼진 ADMIN 이 에이전트 토큰 발급 → 403. Task 2b 테스트.
- 운영자 플래그 끄기 시도 → 400, 감사 로그 없음. Task 4 테스트.
- 인증 앱 등록 조회 실패(auth 스키마 쿼리 오류) → 목록 전체가 죽지 않고 등록 칸만 「—」. Task 5 테스트.

---

### Task 1: 스키마 + 마이그레이션

**Files:**

- Modify: `prisma/schema.prisma` (`model User` — `platformRole` 아래)
- Create: `prisma/migrations/<ts>_user_mfa_required/migration.sql` (migrate dev 생성)

**Interfaces:**

- Produces: `User.mfaRequired: Boolean @default(false)` — 주석 `// 2단계 인증 필수(계정 단위). false 면 requireAal2 를 통과한다(운영자·ignoreUserFlag 경로 제외).`

- [ ] **Step 1:** 필드 추가 후 `npx prisma migrate dev --name user_mfa_required --create-only` (shadow DB 오류 시 memory `reference_migrate_shadow_bypass` 절차).
- [ ] **Step 2:** 생성된 SQL 끝에 추가 — 이미 인증 앱을 등록(verified)한 모든 계정을 필수로 시작해, 배포 직후 기존 보호 대상(내부 비운영자 포함)에 공백이 없게 한다(Codex 지적 3). shadow DB 에는 `auth` 스키마가 없으므로 가드:
  ```sql
  DO $$ BEGIN
    IF to_regclass('auth.mfa_factors') IS NOT NULL THEN
      UPDATE "User" SET "mfaRequired" = true
      WHERE id::uuid IN (SELECT user_id FROM auth.mfa_factors WHERE status = 'verified');
    END IF;
  END $$;
  ```
  (`User.id` 는 text — 캐스팅 방향은 dev DB 에서 확인. 배포 전 운영에서 대상 수를 읽기 전용 SELECT 로 미리 세어 PR 에 기록, 배포 후 같은 수인지 확인.)
- [ ] **Step 3:** `npx prisma migrate dev` 로 dev DB 적용. Expected: 적용 성공, `npx prisma generate` 완료.
- [ ] **Step 4:** Commit `🗃️ feat(auth): User.mfaRequired 컬럼 (인증 앱 등록 계정 기본 켜짐)`

### Task 2: `requireAal2` 계정 단위 판정

**Files:**

- Modify: `src/lib/auth/mfa.ts`
- Test: `src/lib/auth/__tests__/mfa.test.ts`

**Interfaces:**

- Consumes: `User.mfaRequired`
- Produces: `requireAal2(opts?: { ignoreUserFlag?: boolean }): Promise<NextResponse | null>` (기존 무인자 호출 그대로 동작). helper `isMfaRequiredForCurrentUser(): Promise<boolean>` export(Task 3 재사용) — claims 실패면 `true`(닫힘), 행 없음이면 `false`, 그 외 `mfaRequired || platformRole === 'OPERATOR'`.

판정 순서: ① `ADMIN_REQUIRE_MFA === 'false'` → null ② `ignoreUserFlag` 이면 ④로 ③ `isMfaRequiredForCurrentUser()` false → null ④ `isAal2Fresh()` 판정(기존).

- [ ] **Step 1: 실패 테스트 추가** (mock 에 `getClaims`, `@/lib/prisma` 추가)
  - `mfaRequired=false 면 aal1 이어도 requireAal2 통과` → `toBeNull()`
  - `mfaRequired=true 면 aal1 은 403 MFA_REQUIRED`
  - `mfaRequired=true 이고 fresh aal2 면 통과`
  - `claims 실패면 aal1 은 403 (닫힘)` — `getClaims` → `{ data: null, error: new Error() }`, prisma 미호출 확인
  - `User 행 없으면 통과`
  - `운영자는 mfaRequired=false 여도 aal1 이면 403`
  - `ignoreUserFlag 면 mfaRequired=false 여도 aal1 이면 403, 비상 해제면 통과`
  - `requireFreshAal2 는 mfaRequired=false 여도 aal1 이면 403` (반목표 고정)
  - 기존 비상 해제 테스트 유지
- [ ] **Step 2:** `npx jest src/lib/auth/__tests__/mfa.test.ts` → 새 테스트 FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 같은 명령 PASS. 이어서 `npx jest app/api src/lib/admin` — 기존 게이트 테스트들이 `@/lib/auth/mfa` 를 mock 하는지 확인, 깨지면 각 테스트의 mock 에 맞춰 수정(동작 기대값은 바꾸지 않는다).
- [ ] **Step 5:** Commit `✨ feat(auth): 2단계 인증을 계정 단위 필수일 때만 요구`

### Task 2b: 평문 우회 경로는 항상 인증 앱

**Files:**

- Modify: `app/api/spaces/[spaceId]/agents/route.ts:85`, `app/api/spaces/[spaceId]/agents/[agentId]/route.ts:52`, `app/api/spaces/[spaceId]/agents/[agentId]/tokens/route.ts:18`, `app/api/spaces/[spaceId]/secrets/[name]/route.ts`(PUT·DELETE 의 `requireAal2()`)
- Test: 각 경로의 기존 `__tests__` (`agents/__tests__/route.test.ts`, `secrets/__tests__/routes.test.ts`)

- [ ] **Step 1:** 각 테스트에 `requireAal2` 가 `{ ignoreUserFlag: true }` 로 호출되는지 단언 추가 → FAIL
- [ ] **Step 2:** 네 곳 호출을 `requireAal2({ ignoreUserFlag: true })` 로 변경 → PASS
- [ ] **Step 3:** Commit `🔒 security(auth): 에이전트·비밀값 권한 경로는 계정 플래그와 무관하게 2단계 인증`

### Task 3: 계정 설정의 2단계 인증 카드 조건부 표시

**Files:**

- Modify: `app/settings/account/page.tsx`

**Interfaces:**

- Consumes: `isMfaRequiredForCurrentUser()` (Task 2)

- [ ] **Step 1:** 페이지를 `async` 로 바꾸고 `const showMfa = await isMfaRequiredForCurrentUser()` → `{showMfa && <MfaCard />}`. 헤더 설명 문구에서 「2단계 인증,」은 `showMfa` 일 때만.
- [ ] **Step 2:** `npx tsc --noEmit -p .` 통과.
- [ ] **Step 3:** Commit `✨ feat(settings): 2단계 인증 필수 계정에만 인증 카드 표시`

### Task 4: 어드민 토글 API + 사용자 상세

**Files:**

- Create: `app/api/admin/users/[id]/mfa-required/route.ts`
- Create: `app/api/admin/users/[id]/mfa-required/__tests__/route.test.ts`
- Create: `src/lib/admin/mfa-status.ts`
- Modify: `src/lib/validations/admin-users.ts` (`mfaRequiredSchema = z.object({ mfaRequired: z.boolean() })`)
- Modify: `app/api/admin/users/[id]/route.ts` (GET 응답에 `mfaRequired`, `totpEnrolled: boolean | null`)
- Modify: `src/components/admin/user-detail.tsx` (기본 정보 카드에 「2단계 인증」 Switch + 「인증 앱 등록/미등록」)

**Interfaces:**

- Produces: `getVerifiedTotpUserIds(userIds: string[]): Promise<Set<string> | null>` in `src/lib/admin/mfa-status.ts` — `prisma.$queryRaw` 로 `SELECT DISTINCT user_id FROM auth.mfa_factors WHERE status = 'verified' AND factor_type = 'totp' AND user_id = ANY(${ids}::uuid[])`. 오류면 `null`(호출측 「—」). 빈 배열이면 쿼리 없이 빈 Set. (`src/lib/mcp/auth.ts` 의 `auth.sessions` raw 조회와 같은 방식)
- Produces: `POST /api/admin/users/[id]/mfa-required` body `{ mfaRequired: boolean }` → `{ ok: true, mfaRequired }`. ban route(`app/api/admin/users/[id]/ban/route.ts`) 구조 복제: `requireOperator` → 대상 404 → 운영자 대상이면 400 `'운영자 계정은 항상 2단계 인증이 필요합니다'` → zod 422 → `prisma.$transaction(async tx => { tx.user.update(...); await writeAuditLog(actor, mfaRequired ? 'user.mfa_required.on' : 'user.mfa_required.off', 'user', id, { email }, tx) })` — 감사 실패 시 변경도 롤백(Codex 지적 4).

- [ ] **Step 1: 실패 테스트** — 비운영자 401/404(requireOperator 실패 응답 그대로), 대상 없음 404, 운영자 대상 400 + update·`writeAuditLog` 미호출, 잘못된 body 422, 정상 켜기 → transaction 안 `update` `{ mfaRequired: true }` + 감사 action `user.mfa_required.on`(tx 전달), 감사 throw 면 500 이고 응답 ok 아님.
- [ ] **Step 2:** `npx jest app/api/admin/users` → FAIL
- [ ] **Step 3:** route·schema·`mfa-status.ts`·GET 확장·상세 UI 구현. UI 는 위험 구역의 ban Switch 와 같은 패턴(pending 상태, 실패 시 toast·되돌림), 운영자면 Switch disabled + 「운영자는 항상 필수」 보조 문구.
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** Commit `✨ feat(admin): 사용자별 2단계 인증 필수 토글`

### Task 5: 어드민 사용자 목록 칸 + 필터

**Files:**

- Modify: `app/api/admin/users/route.ts`
- Create: `app/api/admin/users/__tests__/route.test.ts`
- Modify: `src/components/admin/users-table.tsx`

**Interfaces:**

- Consumes: `getVerifiedTotpUserIds` (Task 4)
- Produces: 쿼리 `mfa=required|off` → where `{ mfaRequired: true|false }`. 응답 user 에 `mfaRequired: boolean`, `totpEnrolled: boolean | null`.

- [ ] **Step 1: 실패 테스트** — `mfa=required` 면 findMany where 에 `mfaRequired: true`, 응답 `totpEnrolled` 가 helper Set 기준, helper `null` 이면 모든 행 `totpEnrolled: null` 이고 200.
- [ ] **Step 2:** `npx jest app/api/admin/users/__tests__/route.test.ts` → FAIL
- [ ] **Step 3:** 구현. 테이블에 「2단계 인증」 칸(「필수」 Badge + 보조 「인증 앱 등록/미등록/—」, 꺼짐은 muted 「꺼짐」), 기존 role·spaces 필터 Select 옆에 「2단계 인증: 전체/필수/꺼짐」 Select. URL 쿼리 동기화는 기존 필터 방식 그대로.
- [ ] **Step 4:** PASS
- [ ] **Step 5:** Commit `✨ feat(admin): 사용자 목록 2단계 인증 칸·필터`

### Task 6: 구독 현황 「인증 필수 구성원」 칸

**Files:**

- Modify: `src/lib/billing/subscription-admin.ts` (`getSubscriptionAccessOverview`)
- Modify: `src/lib/billing/subscription-admin-types.ts`
- Modify: `src/components/admin/subscriptions-client.tsx`
- Test: `app/api/admin/subscriptions/__tests__/route.test.ts` 또는 overview 단위 테스트(기존 mock 구조 따름)

**Interfaces:**

- Produces: overview `rows[].mfaRequiredMemberCount: number` — space include 에 `_count: { select: { members: { where: { user: { mfaRequired: true } } } } }`.

- [ ] **Step 1: 실패 테스트** — space mock `_count.members = 2` → 해당 space 의 모든 row `mfaRequiredMemberCount === 2`.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 표에 「인증 필수 구성원」 칸(0 이면 「—」, 아니면 「N명」).
- [ ] **Step 4:** PASS
- [ ] **Step 5:** Commit `✨ feat(admin): 구독 현황 인증 필수 구성원 수`

### Task 7: 통합 검증

- [ ] `npm run lint` · `npx tsc --noEmit -p .` · `npx jest` 전체 · `npm run build` 통과.
- [ ] 로컬 dev(memory `reference_local_dev_qa_login`) 수동 확인:
  1. 인증 앱 없는 일반 계정으로 구성원 초대(ADMIN 역할) → 403 없이 성공, 계정 설정에 2단계 인증 카드 없음.
  2. 어드민에서 그 계정 「필수」 켜기 → 감사 로그 확인 → 같은 동작 시 `/auth/mfa` 로 이동(등록 QR).
  3. 사용자 목록 「필수만」 필터·칸, 구독 현황 칸 표시.
  4. 운영자 계정 상세에서 Switch disabled, 운영자는 `requireAal2` 경로에서 여전히 인증 요구.
  5. 비밀값 보기(`/reveal`)·에이전트 토큰 발급·비밀값 저장은 꺼진 계정도 여전히 인증 요구.
- [ ] `/code-review` → `security-review` (구현 후).

## 배포·롤백

- 배포 전: 운영 DB 읽기 전용 SELECT 로 인증 앱 등록(verified) 계정 수·목록을 확인해 PR 에 기록(Kaleos 내부 계정 포함 여부 확인, 빠진 내부 계정이 있으면 배포 보류하고 에디에게 알림).
- 배포: develop → main 릴리스, Vercel `prisma migrate deploy` 가 컬럼 추가 + 등록 계정 켜기 적용. 배포 후 어드민 「필수만」 필터 수 = 배포 전 수 확인. 모집 고객 중 등록 계정을 끌지는 에디가 어드민에서 판단.
- 롤백: 앱 커밋 revert 만으로 이전 동작(모두 필수) 복귀. 컬럼은 남아도 무해(기본 false, 읽는 코드 없음). 컬럼 제거는 별도 마이그레이션으로만.
- 비상: `ADMIN_REQUIRE_MFA=false` 기존 의미 유지.

## Codex 비판 검토 반영 (2026-11-25)

지적 4건 — 반영 4, 보류 0.

1. [critical] 에이전트 토큰 발급으로 평문 비밀값 우회 → Task 2b: 에이전트·토큰·비밀값 권한 경로는 `ignoreUserFlag` 로 항상 인증 앱.
2. [high] 마이그레이션 뒤 승격된 운영자 → 게이트에서 `platformRole === OPERATOR` 면 항상 요구(마이그레이션 의존 제거).
3. [high] 내부 비운영자 보호 공백 → 마이그레이션이 인증 앱 등록 계정 전체를 필수로 시작 + 배포 전후 수 대조.
4. [high] 플래그 변경·감사 비원자 → 같은 transaction(`writeAuditLog(..., tx)`).
