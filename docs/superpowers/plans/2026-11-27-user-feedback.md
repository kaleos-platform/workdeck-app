# 의견 남기기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인 이용자가 사이드바 「의견 남기기」로 의견(이미지 최대 3장)을 보내고, 운영자가 어드민 「의견」에서 상태·메모·첨부를 관리하며, 첨부는 완료 30일·보류 90일 뒤 자동 삭제된다.

**Architecture:** 「도입 신청」(`MarketingLead` · `/admin/leads` · `src/lib/marketing/lead-notify.ts`) 구조를 따른다. 첨부는 비공개 Storage 버킷 `feedback-files`, 서버 service-role 업로드(hiring 어댑터 방식). 탈퇴 시 파일 정리는 `HiringFileDeletion`과 같은 FK 없는 삭제 원장 + cron.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Supabase Storage, Zod, shadcn/ui, Jest. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-27-user-feedback-design.md` (비용 메모: `docs/superpowers/specs/2026-11-27-user-feedback-cost-review.md` — 아래 「비용 검토 반영」에 채택분만 적용)

## Global Constraints

- 유형 enum `FEATURE BUG QUESTION REVIEW OTHER`(표시: 기능 제안·서비스 오류·문의·이용 후기·기타). 상태 `NEW IN_PROGRESS DONE ON_HOLD`(접수·확인 중·완료·보류).
- 본문 1~5000자(trim 후), 메모 ≤2000자, 첨부 ≤3장, 장당 ≤1 MiB(1_048_576 bytes), png/jpeg/webp/gif(매직바이트 `sniffImage`).
- 보관: DONE closedAt+30일, ON_HOLD closedAt+90일에 첨부만 삭제. 본문 보존.
- 총 첨부 상한 `FEEDBACK_STORAGE_CAP_MB`(기본 500, `0`=첨부 받지 않음). 점유량 = 미삭제(`deletedAt IS NULL`) 첨부 sizeBytes 합 + 삭제 원장(`FeedbackFileDeletion.bytes`) 합. 점유량 + 이번 요청 바이트 > 상한이면 첨부 거부·본문만 저장.
- **파일 경로는 항상 DB 어딘가에 있다**: 업로드 전 원장 기록 → 업로드 → 첨부 행 생성과 원장 행 삭제를 한 transaction. 어느 단계에서 끊겨도 원장이 남아 cron이 정리.
- Slack: `FEEDBACK_SLACK_WEBHOOK_URL` → 없으면 `LEAD_SLACK_WEBHOOK_URL` → 없으면 생략. 원본·서명 URL 미포함. `after()`로 응답 후 실행.
- Supabase 이미지 변환(transform) 사용 금지. 목록에서 이미지 로드 금지, 상세에서만 서명 URL(600초).
- 스키마는 `npx prisma migrate dev`만. 신규 테이블 `ENABLE ROW LEVEL SECURITY`(선례 `20261121120000_channel_order_observe`).
- 어드민 API 첫 줄 `requireOperator()`, 변경은 `writeAuditLog(..., tx)` 같은 transaction.
- UI는 `workdeck-ui` 스킬 + `DESIGN.md`. 화면 구조는 Task 0 와이어프레임 합의안대로.
- 커밋 스타일 `✨ feat: …`, 릴리스는 develop → develop 환경 검증 → main.

## 비용 검토 반영(Codex 메모 중 채택/보류)

- 채택: 상한 도달 시 응답 `attachmentsAccepted:false` + Dialog 안내 / 화면 주소는 **pathname만 저장**(query 미저장 — 설계의 pathname+search에서 변경, 토큰·검색어 유출 방지) / Slack `after()` / 감사 로그 tx / cron bounded batch(100건) / Storage 삭제 성공분만 `deletedAt` 기록.
- 보류: advisory lock·예약 상태머신·lease — 상한 500MB 대비 동시 요청 초과분은 수 MB로 비용 영향 0. rate limiter 분리 — 도입 신청 라우트가 이미 `checkRateLimit('lead:…')`로 재사용 중, 같은 방식. 기능 기본 비활성 플래그 — `FEEDBACK_STORAGE_CAP_MB=0`이 첨부 kill switch.
- 운영 릴리스(main) 게이트: Spend Cap 상태 + 포함량 여유 확인 후(Task 8 Step 4). 로컬·develop 구현은 진행. egress는 상한이 없으므로 Spend Cap ON이 무과금 보장의 최종 조건, OFF면 포함량 여유(250GB 대비 의견 이미지 열람은 MB 단위)로 실질 0원.

## Codex 계획 검토(2026-11-27): 지적 7건 — 반영 7, 보류 0

고아 파일(업로드 전 원장 예약)·RLS(`--create-only`)·재개 경쟁(선점 updateMany 후 삭제)·롤백 순서·원장 bytes 상한 포함·Spend Cap 게이트·버킷 fail closed. 원래 제안의 lease·advisory lock 대신 위의 작은 방식으로 반영.

## Review Focus

1. 탈퇴 사용자 첨부 — 사용자 삭제 후에도 Storage 파일이 남지 않아야 함(원장 → cron 재시도). Task 5 테스트.
2. 완료→다시 확인 중으로 되돌린 건 — cron이 첨부를 지우면 안 됨. Task 2·6 테스트.
3. 상한 도달 — 의견은 접수, 이미지 미저장이 이용자에게 보임. Task 3·7 테스트.
4. Storage 일부 삭제 실패 — 실패 경로는 `deletedAt` null로 남아 다음 실행에 재시도. Task 6 테스트.
5. 작업 공간 없는 사용자 — 제출 성공, spaceId null. 비구성원 요청 등 403은 그대로 거절. Task 3 테스트.

---

### Task 0: 화면 와이어프레임 합의

**Files:** Create `docs/design/plans/user-feedback/`(repo `ui-plan` 스킬 산출물 위치 관례 따름)

- [ ] **Step 1:** `.claude/skills/ui-plan/SKILL.md` 절차로 ① 사이드바 버튼(펼침/접힘) + Dialog(유형 라디오 5, 본문, 이미지 3장 미리보기·제거, 상한 안내 상태) ② 어드민 목록(요약: 상태별 건수·총 첨부 용량, 필터: 유형·상태) ③ 어드민 상세(본문·화면 경로·브라우저·상태·메모·mailto·첨부 썸네일·삭제 예정일·「첨부 지금 삭제」) 데스크톱 + 390px 미리보기(PNG + 라이브 주소) 작성. 합성 데이터만.
- [ ] **Step 2:** 에디 합의 받고 `plan.md`에 확정 구조 기록. 커밋.

### Task 1: 스키마 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_user_feedback/migration.sql`(migrate dev 생성)

**Interfaces:**
- Produces: `UserFeedback`, `UserFeedbackAttachment`, `FeedbackFileDeletion`, enum `UserFeedbackType`, `UserFeedbackStatus` (필드는 설계 문서 그대로. 단 `pagePath`는 pathname만)
- `UserFeedback.user` → User `onDelete: Cascade`, `space` → Space `onDelete: SetNull`, User/Space에 역관계 추가.
- `FeedbackFileDeletion { id String @id @default(cuid()); paths Json; bytes Int @default(0); attempts Int @default(0); lastError String?; createdAt DateTime @default(now()); @@index([createdAt]) }` — FK 없음, PII 없음. 용도 2가지: 업로드 진행 중 경로 예약(성공 시 삭제), 탈퇴·실패 후 삭제 대기.

- [ ] **Step 1:** 스키마 추가 후 `npx prisma migrate dev --create-only --name user_feedback` (적용 전 SQL만 생성). shadow DB 오류 시 memory `reference_migrate_shadow_bypass` 절차.
- [ ] **Step 2:** 생성 SQL 끝에 세 테이블 `ALTER TABLE "…" ENABLE ROW LEVEL SECURITY;` 추가(선례와 동일) → `npx prisma migrate dev`로 최초 적용 → `npx prisma migrate status` = up to date. dev DB에서 `select relname, relrowsecurity from pg_class where relname in (...)` 세 행 모두 true 확인(dev 전용 읽기 조회).
- [ ] **Step 3:** `npm run typecheck` PASS. 커밋 `✨ feat(feedback): 의견 스키마`.

### Task 2: 정책 순수 함수

**Files:**
- Create: `src/lib/feedback/policy.ts`, `src/lib/feedback/__tests__/policy.test.ts`

**Interfaces:**
- Produces:
  - `FEEDBACK_TYPES`, `FEEDBACK_STATUSES`, `FEEDBACK_TYPE_LABEL: Record<UserFeedbackType,string>`, `FEEDBACK_STATUS_LABEL`
  - `feedbackInputSchema` (zod: `type`, `body` trim 1~5000, `pagePath` optional `/`로 시작 ≤500, query·hash 제거)
  - `adminUpdateSchema` (zod: `status?`, `memo?` ≤2000 nullable)
  - `nextClosedAt(current: Status, next: Status, currentClosedAt: Date|null, now: Date): Date|null`
  - `attachmentDeleteAt(status: Status, closedAt: Date|null): Date|null`
  - `MAX_FILES=3`, `MAX_FILE_BYTES=1_048_576`, `storageCapBytes(env = process.env): number`

- [ ] **Step 1: 실패 테스트**

```ts
const t = new Date('2026-01-01T00:00:00Z'), now = new Date('2026-02-01T00:00:00Z')
expect(attachmentDeleteAt('DONE', t)).toEqual(new Date('2026-01-31T00:00:00Z'))
expect(attachmentDeleteAt('ON_HOLD', t)).toEqual(new Date('2026-04-01T00:00:00Z'))
expect(attachmentDeleteAt('IN_PROGRESS', t)).toBeNull()
expect(nextClosedAt('DONE', 'DONE', t, now)).toEqual(t)          // 메모만 저장
expect(nextClosedAt('DONE', 'ON_HOLD', t, now)).toEqual(now)
expect(nextClosedAt('DONE', 'IN_PROGRESS', t, now)).toBeNull()   // 삭제 예약 취소
expect(nextClosedAt('NEW', 'DONE', null, now)).toEqual(now)
expect(feedbackInputSchema.safeParse({ type: 'BUG', body: '   ' }).success).toBe(false)
expect(feedbackInputSchema.safeParse({ type: 'BUG', body: 'x'.repeat(5001) }).success).toBe(false)
expect(feedbackInputSchema.parse({ type: 'BUG', body: 'a', pagePath: '/d/x?token=1#h' }).pagePath).toBe('/d/x')
expect(storageCapBytes({ FEEDBACK_STORAGE_CAP_MB: '0' })).toBe(0)
expect(storageCapBytes({})).toBe(500 * 1024 * 1024)
expect(storageCapBytes({ FEEDBACK_STORAGE_CAP_MB: 'abc' })).toBe(0)  // 잘못된 값 = 첨부 끔
```

- [ ] **Step 2:** `npx jest src/lib/feedback/__tests__/policy.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3:** 구현(Prisma enum 타입만 import, Storage import 금지).
- [ ] **Step 4:** 재실행 PASS. 커밋.

### Task 3: Storage 어댑터 + 제출 API + Slack

**Files:**
- Create: `src/lib/feedback/storage.ts`, `src/lib/feedback/notify.ts`, `src/lib/feedback/submit.ts`, `app/api/feedback/route.ts`, `app/api/feedback/__tests__/route.test.ts`, `src/lib/feedback/__tests__/notify.test.ts`

**Interfaces:**
- Consumes: Task 2 전부. `sniffImage`(`src/lib/hiring/storage.ts`), `checkRateLimit`(`src/lib/hiring/applications.ts`), `resolveRequestedSpaceContext(null)`(`src/lib/api-helpers.ts`), `buildAdminUrl`(`src/lib/domain.ts`), `getUser`.
- Produces:
  - `FEEDBACK_FILES_BUCKET = 'feedback-files'`
  - `uploadFeedbackFile(path: string, data: Uint8Array, mime: string): Promise<void>`
  - `removeFeedbackFiles(paths: string[]): Promise<{ removed: string[]; failed: string[] }>` (Supabase `remove` 반환 목록으로 성공분 판정. 없는 경로는 removed로 취급 — 멱등)
  - `assertFeedbackBucket(): Promise<void>` — hiring `getBucket` 선례처럼 `public === false`·file_size_limit ≤1 MiB 확인, 아니면 throw(업로드·서명 모두 fail closed). 프로세스당 1회 캐시.
  - `signFeedbackFile(path: string, seconds = 600): Promise<string>`
  - `notifyFeedbackSlack(input: { id; type; userEmail; spaceName: string|null; pagePath: string|null; body; attachmentCount; capReached: boolean }): Promise<void>` — throw 안 함
  - `POST /api/feedback` multipart(`type`, `body`, `pagePath`, `files[]`) → 201 `{ id, attachmentsAccepted: boolean, attachmentReason: 'cap' | null }`

- [ ] **Step 1: 실패 테스트(route)** — prisma·storage·getUser mock:
  - 비로그인 → 401
  - `type:'NOPE'` → 400, 빈 본문 → 400
  - 4장 → 400, 1 MiB+1 파일 → 413, 확장자 png인데 매직바이트 불일치 → 400
  - `checkRateLimit` false → 429, 키가 `feedback:${userId}`
  - 작업 공간 없음(`resolveRequestedSpaceContext`가 404) → 201, `spaceId:null`
  - 비구성원 403 → 403 그대로
  - 상한: 기존 합 499MiB + 요청 2MiB(cap 500) → 201 `attachmentsAccepted:false, attachmentReason:'cap'`, 업로드 미호출, 첨부 행 0
  - 정상 2장 → 201, `uploadFeedbackFile` 2회, 경로 `${id}/${uuid}.${ext}`(원본 파일명 미사용), 첨부 행 2
  - 업로드 전 `feedbackFileDeletion.create({ paths, bytes })`가 업로드보다 먼저 호출
  - 정상 경로: 첨부 createMany와 원장 행 delete가 같은 `$transaction`
  - 업로드 2번째 실패 → 500, 즉시 `removeFeedbackFiles` 시도·성공 시 원장 삭제, 실패 시 원장 유지(삭제 안 함), 의견 행 삭제
  - 버킷 public이면(`assertFeedbackBucket` throw) 첨부 있는 요청 503, 업로드 미호출
  - 본문에 `userId`/`spaceId` 필드를 넣어도 무시(세션 값 사용)
- [ ] **Step 2: 실패 테스트(notify)** — fetch mock: 전용 webhook 우선, 없으면 LEAD, 둘 다 없으면 fetch 미호출 / 본문 301자 → 300자+… / `<&>` escape / 어드민 링크 `buildAdminUrl('/admin/feedback/'+id)` 포함 / `capReached` 시 "첨부 용량 상한 도달" 문구 / fetch reject여도 resolve.
- [ ] **Step 3:** 실행 → FAIL.
- [ ] **Step 4:** 구현. 요청 처리 순서: getUser → Content-Length > 4_000_000이면 413 → formData → zod → 파일 검증 → rate limit → space 결정 → 상한 계산(첨부 `_sum sizeBytes where deletedAt null` + 원장 `_sum bytes`) → 의견 create → 원장 create(경로 예약) → 업로드 → `$transaction[첨부 createMany, 원장 delete]` → `after(() => notifyFeedbackSlack(...))` → 201. `submit.ts`에 핵심 로직, route는 얇게.
  - `// ponytail: 상한 검사는 lock 없음 — 동시 요청 시 수 MB 초과 가능, 포함량 100GB 대비 무시. 정밀 상한 필요 시 advisory lock.`
- [ ] **Step 5:** PASS. 커밋.

### Task 4: 이용자 Dialog + 사이드바 입구

**Files:**
- Create: `src/components/feedback/feedback-dialog.tsx`, `src/components/feedback/compress-image.ts`, `src/components/feedback/__tests__/feedback-dialog.test.tsx`
- Modify: `src/components/layout/sidebar.tsx`(하단 로그아웃 버튼 블록 바로 위, 같은 스타일, 아이콘 `MessageSquarePlus`, 접힘=Tooltip+aria-label)

**Interfaces:**
- Consumes: `POST /api/feedback`, `FEEDBACK_TYPE_LABEL`, `MAX_FILES`, `MAX_FILE_BYTES`
- Produces: `<FeedbackDialog open onOpenChange />`, `compressImage(file: File): Promise<Blob>`(canvas, 최장변 1600px, `image/webp` 0.8, 미지원 시 `image/jpeg` 0.8)

- [ ] **Step 1: 실패 테스트** (fetch·compressImage mock): 유형 미선택/본문 빈칸이면 제출 비활성 / 제출 중 버튼 disabled(중복 방지) / 4번째 이미지 추가 불가 / 압축 후 1 MiB 초과 파일은 파일별 오류, 전송 제외 / 500 응답 시 입력 유지 + 오류 문구 / 201 `attachmentsAccepted:true` → 토스트 "의견이 접수됐어요. 확인 후 조치할게요." + 닫힘 + 초기화 / `attachmentsAccepted:false` → "의견은 접수됐지만 이미지는 저장되지 않았어요" 표시 / `pagePath`로 `location.pathname` 전송.
- [ ] **Step 2:** FAIL 확인 → 구현(Task 0 합의안, 안내 문구: "불편한 점, 제안하고 싶은 기능, 오류를 남겨주시면 확인 후 조치할게요. 자세히 적을수록 빨라요.", GIF는 정지 이미지로 저장된다는 보조 문구) → PASS.
- [ ] **Step 3:** 커밋.

### Task 5: 어드민 API + 탈퇴 원장

**Files:**
- Create: `app/api/admin/feedback/[id]/route.ts`(PATCH), `app/api/admin/feedback/[id]/attachments/route.ts`(GET 서명 URL, DELETE 즉시 삭제), 각 `__tests__/route.test.ts`
- Modify: `app/api/admin/users/[id]/route.ts:191` 직전, 해당 테스트

**Interfaces:**
- Consumes: Task 2 `adminUpdateSchema`, `nextClosedAt`; Task 3 `removeFeedbackFiles`, `signFeedbackFile`
- Produces: `PATCH /api/admin/feedback/:id {status?, memo?}` → 200 갱신 행; `GET …/attachments` → `[{id, url, mimeType, sizeBytes, deletedAt}]`; `DELETE …/attachments` → `{ removed, failed }`

- [ ] **Step 1: 실패 테스트:** 비운영자 → `requireOperator` 결과 그대로(404) / 없는 id 404 / PATCH DONE→IN_PROGRESS면 `closedAt:null` / 메모만 변경 시 closedAt 유지 / `writeAuditLog`가 같은 tx로 호출되고 meta에 본문 없음 / audit throw 시 update 롤백 / GET은 deletedAt null만 서명, 삭제 부작용 없음 / DELETE에서 remove 일부 실패 → 성공분만 `deletedAt`, 응답 failed 포함 / 사용자 삭제 시 tx 안에서 `feedbackFileDeletion.create({ paths, bytes })`가 `tx.user.delete` 전에 호출(미삭제 첨부 없으면 생략; 진행 중 업로드는 Task 3 예약 원장이 이미 커버), commit 후 즉시 `removeFeedbackFiles` 시도, 성공 시 원장 행 삭제, 실패해도 탈퇴 응답은 성공.
- [ ] **Step 2:** FAIL → 구현 → PASS. 커밋.

### Task 6: 첨부 정리 cron

**Files:**
- Create: `src/lib/feedback/cleanup.ts`, `src/lib/feedback/__tests__/cleanup.test.ts`, `app/api/cron/feedback-attachment-cleanup/route.ts`
- Modify: `vercel.json`(crons: `{ "path": "/api/cron/feedback-attachment-cleanup", "schedule": "0 18 * * *" }` = 03:00 KST, functions maxDuration 60)

**Interfaces:**
- Produces: `runFeedbackCleanup(now: Date, batch = 100): Promise<{ expiredRemoved: number; expiredFailed: number; ledgerDone: number; ledgerFailed: number }>`; route = `withCronRun('/api/cron/feedback-attachment-cleanup', …)`

- [ ] **Step 1: 실패 테스트:** DONE closedAt 31일 전 → 삭제 / DONE 29일 전 → 유지 / ON_HOLD 89일 → 유지, 91일 → 삭제 / IN_PROGRESS(closedAt null) → 유지 / **선점 후 재개**: 선점(claim) updateMany가 상태·closedAt 조건을 다시 걸어 0건이면 Storage 미호출 / remove 일부 실패 → 실패분 deletedAt null로 되돌림 / 원장 행: createdAt 1시간 미만은 건너뜀(업로드 진행 중), 처리 성공 → 행 삭제, 실패 → attempts+1·lastError / batch 상한 100.
- [ ] **Step 2:** FAIL → 구현. 순서 = 후보 id 조회 → `updateMany({ where: { id: in, deletedAt: null, feedback: { status, closedAt: { lte: cutoff } } }, data: { deletedAt: now } })`로 **먼저 선점** → 선점된 행만 다시 읽어 Storage remove → 실패 경로 `deletedAt: null` 복구. 선점 이후의 재개는 "첨부 삭제됨"으로 상세에 표시(순서 확정, 별도 lock 없음). → PASS. 커밋.

### Task 7: 어드민 화면 + 메뉴 + 개인정보 고지

**Files:**
- Create: `app/admin/feedback/page.tsx`, `app/admin/feedback/[id]/page.tsx`, `src/components/admin/feedback-table.tsx`, `src/components/admin/feedback-detail.tsx`, `src/components/admin/__tests__/feedback-table.test.tsx`
- Modify: `app/admin/layout.tsx` NAV_ITEMS(`{ href: '/admin/feedback', label: '의견' }`, '도입 신청' 뒤), `app/(marketing)/privacy/page.tsx`

**Interfaces:**
- Consumes: Task 2 라벨·`attachmentDeleteAt`, Task 5 API

- [ ] **Step 1: 실패 테스트(table):** 상태·유형 필터 URL 파라미터 반영 / 첨부 수만 표시(img 태그 없음) / 요약에 상태별 건수·총 용량(MB 소수 1자리) / 행 클릭 → 상세 링크.
- [ ] **Step 2:** 구현: 페이지 서버 컴포넌트 첫 줄 `requireOperator()`, 목록 createdAt desc·id desc, 50건 offset 페이지네이션(memory `reference_prisma_cursor_nullable_sort` — offset 사용). 상세: 첨부 썸네일은 GET attachments 서명 URL, 삭제 예정일 = `attachmentDeleteAt`, 「첨부 지금 삭제」 확인 다이얼로그, 제출자 `mailto:`. 표 폭은 memory `project_table_column_width_maxw_dead` 주의(table-fixed+colgroup).
- [ ] **Step 3:** 개인정보처리방침 수집 항목에 추가: "의견 남기기 — 의견 내용, 첨부 이미지, 이용 화면 주소, 브라우저 정보 / 문의 응대·서비스 개선 / 회원 탈퇴 시 파기(첨부는 처리 완료 30일·보류 90일 후 파기)". 기존 표 형식·개정일 관례 따름.
- [ ] **Step 4:** PASS. 커밋.

### Task 8: 검증 + 릴리스

- [ ] **Step 1:** `npx jest src/lib/feedback app/api/feedback app/api/admin/feedback app/api/admin/users src/components/feedback src/components/admin --runInBand` PASS, `npm run typecheck`, `npm run lint`, `npm run build` PASS.
- [ ] **Step 2:** dev 버킷 `feedback-files` 생성 요청(에디, 대시보드: public off, 1 MB, MIME png/jpeg/webp/gif). 로컬 dev 서버 + memory `reference_local_dev_qa_login`으로 제출(이미지 2장)→어드민 목록·상세·상태 변경·첨부 삭제 실제 확인, 데스크톱+390px 캡처.
- [ ] **Step 3:** `/code-review`(코드 리뷰) → 반영. PR base develop, 머지 후 develop 환경에서 Step 2 흐름 재확인.
- [ ] **Step 4(게이트):** 에디가 Supabase 조직 플랜·Spend Cap ON/OFF·청구 주기 Storage/egress 사용량을 확인해 계획 「운영 확인값」에 기록(비밀값 제외) + prod 버킷 생성(설정은 `assertFeedbackBucket` 통과로 재확인) + 익명 공개 URL 접근 400/404 확인 + `FEEDBACK_SLACK_WEBHOOK_URL` 등록 후 release PR(develop→main). 배포 후 prod에서 qa 계정 1건 제출→Slack 수신·어드민 확인→테스트 건 삭제.

## 롤백

- 1단계(즉시): `FEEDBACK_STORAGE_CAP_MB=0` 후 redeploy → 새 첨부 중단. 사이드바 입구만 숨기려면 UI 커밋만 revert(테이블·cron 유지).
- 2단계(완전 제거): 남은 첨부 전부 상태 무관 삭제(운영자 일괄 삭제 또는 cron 1회 강제) + 원장 0건 확인 **후에만** 코드 revert와 drop 마이그레이션. 테이블을 먼저 지우지 않는다(경로 유실 → 개인정보 잔존).
