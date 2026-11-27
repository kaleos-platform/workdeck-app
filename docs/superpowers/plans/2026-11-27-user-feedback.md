# 의견 남기기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 현재 세션에서 직접 실행하며 별도 위임은 필요할 때만 한다.

**Goal:** 로그인 이용자의 의견을 앱 안에서 접수하고 운영자가 상태·메모·첨부 수명주기를 관리한다. Supabase 추가 과금 방지 조건을 확인한 후 운영 활성화한다.

**Architecture:** 기존 도입 신청의 운영자 인증·감사 로그·Slack 알림 패턴과 비공개 Storage를 재사용한다. 업로드 예약과 삭제 재시도 정보를 DB에 남겨 용량 상한·탈퇴 삭제·상태 재개 경쟁을 관리한다. 앱·어드민 기능은 기본 비활성으로 준비하고 비용 조건 확인 뒤 활성화하는 안을 제안한다.

**Tech Stack:** 기존 Next.js App Router, TypeScript, Prisma, Supabase Storage, Zod, shadcn, Jest. 신규 패키지·프로젝트·Compute tier·이미지 변환·Realtime·Edge Functions 없음.

---

## 실행 경계

- 작업 경로 `/Users/kaleos/projects/kaleos/workdeck-app-user-feedback`, 브랜치 `feat/user-feedback`, 시작 HEAD `d35bfc0a`. 루트의 다른 기능 브랜치를 변경하지 않는다.
- 원 설계 `docs/superpowers/specs/2026-11-27-user-feedback-design.md`와 비용 검토 `docs/superpowers/specs/2026-11-27-user-feedback-cost-review.md`를 함께 적용한다. 비용 검토의 새 동작은 아직 제안이며 사용자 결정과 혼동하지 않는다.
- 자격증명·환경 파일 조회/복사/pull 금지. 실제 DB 연결이 필요한 단계는 비밀값을 다루지 않는 승인된 실행 경로가 준비되기 전까지 실행하지 않는다.
- DB migration·배포·장시간 테스트 전 `/Users/kaleos/projects/kaleos/workdeck-app/.agent-continuity/HOLD`를 만들고 `finally`/shell trap으로 제거한다. 같은 디렉터리 `TASKS.md`에 결과와 한계를 기록한다.
- UI는 `.codex/skills/workdeck-ui/SKILL.md`, `.claude/skills/ui-plan/SKILL.md`, `DESIGN.md` 기준. 새 화면 미리보기 합의가 필요하며 기존 승인이 있으면 반복 요청하지 않는다. 현재 인계에는 와이어프레임 승인 증거가 없다.
- Slack 코드 작성은 가능하지만 실제 메시지 전송은 사용자 명시 지시가 있기 전 수행하지 않는다. 단위 테스트 fetch mock만 사용한다.

## 파일과 책임

| 경로 | 책임 |
|---|---|
| `prisma/schema.prisma`, 생성 migration | 의견·첨부·삭제 작업·관계·인덱스·RLS |
| `src/lib/feedback/policy.ts` | 유형·상태·입력 검증·보관 날짜·상태 전이 |
| `src/lib/feedback/service.ts` | 의견 생성, 첨부 예약, 상태·메모 변경 transaction |
| `src/lib/feedback/storage.ts` | feedback-files 업로드·삭제·서명 URL; 서버 전용 |
| `src/lib/feedback/cleanup.ts` | 기한 지난 첨부 claim, Storage 삭제, 재시도·점유량 회수 |
| `src/lib/feedback/notify.ts` | Slack payload 구성·escape·환경 표시·실패 격리 |
| `src/lib/rate-limit.ts` | 기존 in-memory limiter 이동; 기존 호출 호환 |
| `app/api/feedback/route.ts` | 로그인·요청 경계·multipart 검증·접수 응답 |
| `app/api/admin/feedback/[id]/route.ts` | 운영자 상태·메모 변경 |
| `app/api/admin/feedback/[id]/attachments/route.ts` | 운영자 서명 URL·즉시 삭제 |
| `app/api/cron/feedback-attachment-cleanup/route.ts` | 기존 withCronRun·cron 인증 재사용 |
| `src/components/feedback/feedback-dialog.tsx`, `src/components/layout/sidebar.tsx` | 이용자 접수 Dialog와 사이드바 입구 |
| `app/admin/feedback/page.tsx`, `app/admin/feedback/[id]/page.tsx` | 서버 조회·필터·상세 진입 |
| `src/components/admin/feedback-table.tsx`, `src/components/admin/feedback-detail.tsx` | 목록·운영자 편집 UI |
| `app/admin/layout.tsx`, `vercel.json`, `app/(marketing)/privacy/page.tsx` | 메뉴·cron 등록·개인정보 고지 |
| `app/api/admin/users/[id]/route.ts` | 탈퇴 transaction에 삭제 작업 적재 |
| 각 모듈 `__tests__` | 검증·권한·예약 경쟁·부분 실패·재시도·UI 회귀 |

## Task 1: 비용 조건과 화면 구조 확정

- [x] 원 설계와 현재 구현 조사: 설계 2커밋만 있으며 기능 코드는 없음.
- [x] 공식 Supabase 문서로 비용 보장 한계 검토, 비용 보완 문서 저장.
- [ ] 현재 Spend Cap 상태와 실제 포함량 여유 확인. API key나 DB URL은 요청하지 않는다.
- [ ] 비용 검토의 활성화 조건, pathname만 저장하는 안전안, 첨부 미저장 안내를 기존 사용자 요구와 대조해 확정.
- [ ] `docs/design/plans/user-feedback/`에 Dialog·어드민 목록·상세 데스크톱/390px skeleton 작성. 기존 sidebar의 로그아웃 위 버튼, 모바일 상세 세로 배치를 표시한다.
- [ ] `ui-plan` 미리보기 절차로 합의된 구조를 `plan.md`에 기록한다. 공개된 운영 데이터 대신 합성 데이터만 사용한다.

## Task 2: 순수 입력 검증과 보관 정책

- [ ] `src/lib/feedback/__tests__/policy.test.ts`에 본문 공백/5001자 거절, 5개 유형, 4개 상태, 메모 2000자 제한 테스트를 먼저 작성한다.
- [ ] `feedbackClosedAt(currentStatus,nextStatus,currentClosedAt,now)`는 같은 상태 메모 저장 시 날짜를 유지하고 DONE↔ON_HOLD 전이 때만 now를 새로 기록하는 테스트를 작성한다. NEW/IN_PROGRESS는 null이다.
- [ ] `attachmentDeleteAt(status,closedAt)`는 DONE 30일·ON_HOLD 90일, 그 외/null은 null, 만료 경계 `<= now`로 테스트한다. 날짜 계산은 UTC milliseconds를 사용한다.
- [ ] 실패를 확인한 뒤 `policy.ts`에 Zod 스키마와 순수 함수만 구현한다. generated Prisma·Storage import는 하지 않는다.
- [ ] 단위 테스트와 대상 ESLint를 실행한다. 비밀 환경을 자동 로드하는 runner는 피하고 비밀값 없는 격리 설정으로 실행한다.

정책 예제:

```ts
expect(attachmentDeleteAt('DONE', new Date('2026-01-01T00:00:00Z')))
  .toEqual(new Date('2026-01-31T00:00:00Z'))
expect(feedbackClosedAt('DONE', 'DONE', closedAt, now)).toEqual(closedAt)
expect(feedbackClosedAt('DONE', 'NEW', closedAt, now)).toBeNull()
```

## Task 3: DB 스키마·RLS·삭제 예약 구조

- [ ] 원 설계의 UserFeedback/UserFeedbackAttachment 및 User/Space 반대 관계를 추가한다. User Cascade, Space SetNull. 직접 클라이언트 테이블 조회는 제공하지 않는다.
- [ ] 업로드 예약 상태(RESERVED/READY/DELETE_PENDING/DELETED), 예약 시각·lease와 삭제 큐의 무작위 경로/sizeBytes/시도 시각을 추가한다. 삭제 큐는 User/Feedback Cascade와 독립이며 PII를 넣지 않는다.
- [ ] 용량 집계는 미해제 예약·실제 객체·삭제 큐를 중복 없이 센다. Attachment→삭제 큐 이동과 원래 예약 해제는 같은 transaction이다. Storage 삭제 확인 전까지 용량을 반환하지 않는다.
- [ ] HOLD 생성 후 승인된 dev 실행 경로에서 `npx prisma migrate dev --name user_feedback`로 migration을 생성·적용한다. generated SQL에서 신규 테이블의 RLS 활성화 및 anon/authenticated 직접 접근 불가를 확인한다. 필요한 정책 보완도 migration에 남긴다. `db push`·운영 직접 SQL 금지.
- [ ] 실패·drift가 발생하면 임의 reset하지 않고 결과를 기록한다. 생성 migration은 커밋에 포함한다. 종료 후 HOLD 제거.

## Task 4: 예약·업로드·정리 서비스

- [ ] DB 통합 테스트에서 두 요청이 동시에 마지막 용량을 예약할 때 한 요청만 성공하는 재현을 작성한다. 본문은 각각 접수 가능하되 첨부 수락 결과를 구분한다.
- [ ] transaction 공통 advisory lock 아래 예약 생성까지 수행하고, Storage 업로드는 transaction 밖에서 실행한다. 상한 500MiB와 장당 1MiB는 바이트 단위로 고정한다. 설정값이 잘못되면 첨부를 비활성 처리한다.
- [ ] Storage adapter는 기존 hiring 방식을 참고하되 feedback 전용 bucket 상수 사용. public bucket이나 잘못된 파일 제한이면 업로드와 서명 URL 발급을 거절한다. MIME+magic byte를 대조하고 임의 원본 파일명 대신 UUID를 사용한다.
- [ ] 업로드 실패·DB finalize 실패·업로드 타임아웃 후 실제 성공의 각 경우를 재현한다. 즉시 정리 시도 후 실패는 경로를 보존하고 다음 cron에서 재시도한다. 오래된 업로드가 삭제 후 객체를 재생성하지 않도록 lease 만료+업로드 최대 시간 이후 유예를 두고 재검사한다.
- [ ] 정리 서비스는 bounded batch로 claim→삭제→성공 경로만 DELETED 처리한다. DONE/ON_HOLD의 closedAt를 claim transaction에서 재검사한다. 같은 피드백 상태 변경도 행 lock으로 직렬화한다.
- [ ] Storage 일부 실패 시 성공 객체만 반환·반영하고 실패 경로는 보존하는 테스트를 통과시킨다. API 응답만 성공했다고 객체가 모두 사라졌다고 가정하지 않는다.

## Task 5: 이용자 접수 API와 Slack

- [ ] `/api/feedback` 테스트: 미로그인 401, 잘못된 유형/본문/파일 400, 초과 크기 413, 인스턴스 limiter 초과 429. 클라이언트 `userId/spaceId`는 받지 않는다.
- [ ] 사용자 인증 후 요청 본문을 읽는다. Content-Length 선검사와 실제 읽기 바이트 제한을 함께 적용한다. 3×1MiB와 multipart overhead를 포함해 Vercel 4.5MB보다 낮게 제한한다.
- [ ] 기존 limiter를 공용 파일로 옮기고 hiring 기존 export를 유지한다. 기존 hiring limiter 회귀와 `feedback:{userId}` 키 분리를 테스트한다.
- [ ] 서버에서 현재 membership을 결정한다. 공간 없음만 null로 접수하고 mismatch/forbidden/DB 장애는 null로 삼키지 않는다. pathname 검증은 합의한 정책을 적용한다.
- [ ] 등록 응답은 `{ id, attachmentsAccepted, attachmentReason }`를 반환한다. 중복 클릭은 UI에서 막고 네트워크 재시도에 대한 중복 접수 방침을 명시한다.
- [ ] Slack notifier를 fetch mock으로 테스트한다. 전용 webhook→lead webhook fallback, escape, 본문 300자, 첨부 개수·어드민 링크, 원본·서명 URL 제외. URL/본문이 로그로 유출되지 않게 한다. Next.js `after` 등 응답 이후 실행 보장이 있는 기존 패턴을 확인해 적용하며 미await Promise만 남기지 않는다.

## Task 6: 운영자 API·조회·탈퇴 연동

- [ ] 모든 admin handler와 PII 조회 페이지 첫 단계에 `requireOperator()`를 사용한다. 비운영자 404, MFA 필요 403, 존재하지 않는 의견 404를 테스트한다.
- [ ] 상태·메모 수정은 의견 update와 `writeAuditLog(..., tx)`를 같은 transaction에 묶는다. 감사 기록 실패 시 상태가 바뀌지 않는지 검사한다. 본문·첨부 URL은 감사 meta에 복제하지 않는다.
- [ ] 목록 최신순은 createdAt desc/id desc로 안정화하고 50건 cursor pagination을 사용한다. status/type URL 필터를 서버 검증한다. 목록에서는 서명 URL 생성·이미지 로드 없이 첨부 수만 반환한다.
- [ ] 상태별 건수·총 점유량 집계를 서버에서 가져온다. 상세만 10분 서명 URL을 발급한다. GET에 삭제 부작용을 넣지 않는다. 즉시 삭제는 인증된 명시적 변경 API를 사용한다.
- [ ] 사용자 삭제 transaction에서 pending 삭제 큐를 생성하고 commit 후 삭제를 시도한다. 삭제 실패→cron 재시도 및 Cascade 후 경로 보존을 통합 테스트한다.

## Task 7: 합의된 UI·개인정보 고지

- [ ] 실제 sidebar 로그아웃 위에 버튼을 넣고 접힘 상태 tooltip/aria-label을 제공한다. Dialog는 기존 shadcn 패턴 사용, 새 의존성 없이 canvas 이미지 축소·프리뷰·제거를 구현한다. GIF는 정지 이미지로 변환되는 동작을 안내한다.
- [ ] 폼 검증·전송 중 중복 제출 방지·오류 후 입력 유지·성공 후 초기화·첨부 미수락 응답 안내를 컴포넌트 테스트한다. canvas 실패 및 압축 후 1MiB 초과 시 원본을 보내지 않고 파일별 오류를 표시한다.
- [ ] 어드민 목록은 table-fixed/명시적 폭/min-w-0, 모바일 가로 스크롤, 텍스트 title을 적용한다. 필터 가까이에 가벼운 상태 건수와 첨부 용량을 둔다.
- [ ] 상세에는 본문·pathname·브라우저·상태·메모·mailto·첨부 예정일·즉시 삭제 확인과 삭제 이력을 제공한다. 열람 권한 오류·서명 만료·저장 실패 UI를 검증한다.
- [ ] 개인정보 고지는 실제 저장 항목과 삭제 정책·전달 채널에 맞춘다. 실패 재시도가 있는 파일을 DB Cascade만으로 즉시 파기 완료했다고 표현하지 않는다.

## Task 8: cron·검증·릴리스

- [ ] `withCronRun`과 기존 cron 인증을 적용하고 하루 한 번 실행을 `vercel.json`에 추가한다. 신규 cron 중복·Vercel 플랜 제약은 확인 후 결정한다.
- [ ] `feedback-files` 버킷은 dev/prod 각각 비공개·1MiB·허용 MIME로 운영 담당자가 생성한다. 설정·키를 자동 변경하거나 읽지 않는다.
- [ ] HOLD를 생성하고 `npm test -- --runInBand <feedback 관련 테스트 경로>`, `npm run typecheck`, 대상 ESLint, `npm run lint`, `npm run build`를 실행한다. 필요한 DB 통합 테스트는 별도 dev 경로에서 실행한다. 결과와 기존 실패를 구분하고 HOLD를 제거한다.
- [ ] UI는 URL부터 새로 진입해 desktop/390px 캡처와 키보드·axe 검증. 이전 element ref 재사용 금지. 실고객 데이터와 운영 접수 생성 없이 합성 fixture를 쓴다.
- [ ] 비용 확인값과 미리보기 승인·migration·테스트 증거가 갖춰진 뒤 diff를 검토한다. 누락 항목을 성공으로 간주하지 않는다.
- [ ] develop 환경 검증 후 main 릴리스 순서를 지킨다. 배포는 사용자 권한과 비용 조건이 확인된 시점에 진행하며 HOLD를 사용한다. 실 Slack 전송은 별도 사용자 지시 확인 후 수행한다.

## 현재 상태

문서 검토와 계획 작성만 수행했다. 앱 코드·DB schema·migration·버킷·운영 설정·배포·Slack 메시지 전송은 변경하지 않았다. 기능 테스트나 build 성공을 주장하지 않는다. 구현은 비용 조건 답변과 새 UI 구조 합의 여부를 확인해 이 체크리스트를 갱신하며 진행한다.
