# 어드민 사용자 목록 소속·권한 칸 분리 계획

## 목표

admin.workdeck.work/admin/users 목록에서 「소속 Space·권한」을 「소속」「권한」으로 나누고, 대표 1개 + 「외 N」 + 툴팁으로 줄인다. 권한은 일반 텍스트, 「상태」 칸 제거(운영자는 권한 칸에 합침), 권한 필터를 대표 권한 기준으로 확장. 에디 확정(2026-11-26 grill).

## 확정 사항

- 대표 소속 = 권한 우선(OWNER > ADMIN > MEMBER), 같으면 먼저 소속(`SpaceMember.createdAt` 오름차순), 그래도 같으면 spaceId.
- 소속 칸: 대표 Space 이름(+ 2개 이상이면 「외 N」, N = 나머지 수). 2개 이상일 때만 툴팁: 대표 순서대로 「Space · 권한」 줄 목록.
- 권한 칸: 일반 텍스트. 운영자면 「운영자」(font-medium) + 소속 있으면 「 · 대표 권한」. 소속도 운영자도 아니면 「-」.
- 「상태」 칸 삭제.
- 정렬: 「소속」 헤더 = 기존 `spaces`(소속 개수) 정렬 유지. 「권한」 정렬 없음.
- 필터 「전체 권한」: 운영자 / 소유자 / 관리자 / 멤버. 대표 권한 기준 — 소유자 = OWNER 소속 있음, 관리자 = ADMIN 있음·OWNER 없음, 멤버 = MEMBER 있음·OWNER/ADMIN 없음. 운영자는 `platformRole=OPERATOR`(운영자도 대표 권한 필터에 포함됨). 기존 「일반 사용자」(`role=user`) 항목 제거.
- 「2단계 인증」 칸은 변경 없음.

## 변경 파일

1. `app/api/admin/users/route.ts`
   - `role` 쿼리: `operator | owner | admin | member` (그 외 무시).
   - where 의 `spaceMemberships`·`AND` 조건 충돌 방지: 조건을 `and: Prisma.UserWhereInput[]` 배열에 모아 `AND: and` 로 합친다(spaces some/none, mfa required, role 필터, q 의 OR 는 그대로 최상위).
   - select 에 membership `createdAt` 추가, 응답 `spaceMemberships` 를 대표 순서로 정렬(`ROLE_RANK = { OWNER: 0, ADMIN: 1, MEMBER: 2 }`, createdAt, spaceId). 응답 필드 모양은 그대로(`spaceId, spaceName, role`) — UI 는 `[0]` 을 대표로 쓴다.
2. `app/api/admin/users/__tests__/route.test.ts`
   - 대표 순서 정렬: MEMBER(이른 날짜)·OWNER(늦은 날짜)·OWNER(이른 날짜) → OWNER 이른, OWNER 늦은, MEMBER.
   - `role=admin` → where.AND 에 `{ spaceMemberships: { some: { role: 'ADMIN' } } }` 와 `{ spaceMemberships: { none: { role: 'OWNER' } } }` 포함.
   - `role=member` → some MEMBER + none `{ role: { in: ['OWNER','ADMIN'] } }`.
   - `spaces=none&role=owner` 동시 → 두 조건 모두 AND 에 존재(덮어쓰기 없음).
   - `mfa=required` 와 `q` 동시 → 기존 테스트 유지.
3. `src/components/admin/users-table.tsx`
   - 헤더: 이메일 · 이름 · 소속(정렬 spaces) · 권한 · 가입 경로 · 가입일 · 2단계 인증. 「상태」 제거.
   - 소속 셀: `max-w-48 truncate` 대표 이름 + `text-muted-foreground` 「외 N」. 2개 이상이면 `Tooltip`(`@/components/ui/tooltip`, 루트 layout 에 Provider 있음)으로 감싼다. 툴팁 내용은 `<ul>` 각 줄 `Space · 권한`.
   - 권한 셀: 위 규칙. Badge 사용 안 함(「2단계 인증」 칸 Badge 는 유지).
   - 필터 Select: 「전체 권한 / 운영자 / 소유자 / 관리자 / 멤버」, `w-32` 유지.
   - 행 클릭(router.push)과 툴팁 트리거 충돌 없음 확인 — 트리거는 span, 클릭은 행 전체로 그대로 이동.

## 검증

- `npx jest app/api/admin/users` 통과, `npx tsc --noEmit -p .`, `npm run lint`.
- 로컬 dev(포트 3017, `ADMIN_REQUIRE_MFA=false` 는 **로컬 dev 서버 프로세스에만** 주입 — 운영자 로그인에 인증 앱 코드를 못 넣기 때문. dev DB 의 운영자 계정 사용) 에서 /admin/users: 다중 소속 행의 「외 N」·툴팁, 운영자 행 「운영자 · 소유자」, 필터 4종 결과, 소속 정렬 확인. 스크린샷.
- 위 방법이 막히면 배포 보류.

## 롤백

UI·API 조회만 변경, 스키마 없음. 커밋 revert.

## Codex 비판 검토 반영 (2026-11-26)

지적 3건 — 반영 3(범위 조정 1).

1. [high] 툴팁 키보드·터치 접근 → 소속 셀 트리거를 `tabIndex={0}` span(포커스 시 Radix Tooltip 열림)으로, 잘린 단일 소속에도 `title` 전체 이름. 터치는 범위 조정: 어드민은 데스크톱 운영자 도구이고 행을 누르면 상세(전체 소속·권한)로 이동하므로 별도 터치 제어는 만들지 않는다.
2. [medium] 필터 실제 결과 검증 → 단위 테스트(조건 모양)에 더해, 로컬 QA 에서 dev DB 로 `GET /api/admin/users?role=…` 결과를 실제로 확인한다(임시 데이터: QA 계정 임시 운영자 + 임시 2번째 소속, 끝나면 원복). 조합: role=owner/admin/member/operator, role=owner&spaces=none(빈 결과), role=operator&mfa=off(빈 결과 — 운영자는 항상 필수; AND 배열로 바꾸며 기존 스프레드 덮어쓰기 문제도 해소). 테스트 DB 통합 테스트 도입은 이번 범위 밖.
3. [medium] 배포 후 확인 대체 → 삭제. 로컬 화면·필터 확인이 안 되면 배포 보류하고 에디에게 알린다.
