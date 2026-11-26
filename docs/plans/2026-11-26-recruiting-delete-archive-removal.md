# 모집 관리 — 공고 삭제 · 지원자 삭제 · 보관 상태 폐지

## 목표

1. 마감·작성 중 공고를 삭제한다(지원자·첨부까지 완전 삭제). 모집중 공고는 "마감 처리 후 삭제" 안내만.
2. 보관(ARCHIVED) 상태를 폐지한다. 기존 ARCHIVED 공고는 CLOSED로 변환.
3. 지원자를 완전 삭제한다(상세 1명 + 목록 선택 일괄). 목록 Shift 연속 선택 유지·확인.

## 확정된 결정 (grill 2026-11-26)

| 항목                | 결정                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| 공고 삭제 시 지원자 | 함께 완전 삭제(지원서·메모·알림·첨부 DB 행 + Storage 파일). 확인 창에 지원자 N명 표시, 되돌릴 수 없음 명시 |
| 삭제 허용 상태      | 화면 상태 기준 마감(CLOSED 또는 ACTIVE+마감일 경과)·작성 중(DRAFT). 모집중(OPEN)은 API 409 + 화면 안내     |
| 보관                | 폐지. migration에서 ARCHIVED→CLOSED 후 enum 값 제거                                                        |
| 지원자 삭제         | 완전 삭제(hard delete). 상세 화면 1명 + 목록 선택 일괄                                                     |
| 권한                | 공고·지원자 삭제 모두 OWNER/ADMIN. 화면 버튼은 MEMBER에게 숨김                                             |
| 모집중 삭제 클릭    | 안내 창만(마감 버튼은 기존 것 사용)                                                                        |
| MCP/에이전트        | 삭제 도구 추가 안 함                                                                                       |
| 블랙리스트          | 전화번호 해시 기반 별도 테이블 — 지원자 삭제와 무관, 유지                                                  |

## 현재 코드 (조사)

- `DELETE /api/hiring-posts/postings/[id]` 존재: ADMIN 체크만, 상태 가드 없음, `prisma.hiringPosting.delete` → Cascade로 지원자·첨부 DB 행 삭제, Storage 파일은 남음. 화면 호출처 없음.
- `actions` 라우트 `archive` 케이스 — 화면 호출처 없음(API 전용).
- `HiringApplication` 자식(files·comments·notifications·stores) 모두 `onDelete: Cascade`. 첨부 실체는 `HiringApplicationFile.filePath`(버킷 `hiring-files`).
- 지원자 목록 `applications-table.tsx` 이미 Shift 범위 선택 구현(`applyRangeSelection`, `toggleRow(id, i, e.shiftKey)`). → 실제 브라우저에서 동작 확인만, 깨져 있으면 수정.
- 화면 컴포넌트에 role 전달 없음. 페이지(server)에서 `resolved.role`로 `canExportExcel`만 계산해 내려줌 → 같은 방식으로 `canDelete` 전달.
- `HiringMigrationRecord(targetModel, targetId)` — 오프닝 이관 원장. 암호화된 원본 스냅샷(`sourceSnapshotEnc`, PII 가능) 보관. 이관 재실행 시 `ledger.ts:101-110`이 기존 record의 target을 읽어 대조 → target이 없으면 충돌 처리.

## 변경 파일 · 단계

### 1. 보관 폐지 — 데이터만 바꾸고 enum 값은 남김

- Codex 지적(enum 제거가 `migrate deploy` 시점에 구 코드와 충돌) 반영: **enum 값 `ARCHIVED`는 스키마에 남기고**(주석 "폐지 — 쓰지 않음") 데이터만 변환한다. 값 제거는 YAGNI — 쓰는 곳이 없으면 남아 있어도 무해.
- migration `hiring_archived_to_closed`(`--create-only`, SQL 직접 작성): `UPDATE "HiringPosting" SET status='CLOSED', "updatedAt"=now() WHERE status='ARCHIVED';` — 구 코드도 CLOSED를 정상 처리하므로 배포 순서 무관.
- 코드: `archive` action 제거(`validations/hiring-posts.ts` enum, `actions/route.ts` 케이스·주석), 목록 필터·상태 목록에서 ARCHIVED 제거(`postings/route.ts`, `posting-list.ts`, `postings.ts`, `postings-table.tsx`, `agent/tools/recruiting-tools.ts`), 라벨 제거(`status-badge.tsx`, `posting-status.ts` — 혹시 남은 행은 `CLOSED`로 표시하도록 한 줄 매핑), `home/page.tsx`·`new-posting-button.tsx` 제외 조건 제거. 공개 페이지(`app/p/[uuid]`, `apply`, `hiring-public/applications`)의 ARCHIVED 차단은 남겨도 무해 → 그대로 둠(타입 유지).
- 관련 테스트 기대값 갱신.

### 2. 파일 삭제 원장 `HiringFileDeletion` (신규 테이블)

- Codex 지적(Storage 선삭제 → 부분 실패 시 첨부 유실, 누락 시 PII 잔존) 반영: **DB 삭제와 같은 트랜잭션에서 삭제할 파일 경로를 원장에 기록**하고, 커밋 후 즉시 Storage 삭제 시도 → 성공하면 원장 행 삭제, 실패하면 cron이 재시도.
- `model HiringFileDeletion { id cuid, spaceId String, paths Json, attempts Int @default(0), lastError String?, createdAt }` — FK 없음(Space 삭제 후에도 정리). migration `hiring_file_deletion_ledger`.
- 기존 `HiringUploadCleanup`은 업로드 세션 전용 규칙(경로 3개 이하·세션 id 경로·3시간 지연·참조 검사)이 강해 이관/레거시 파일 경로를 격리 처리한다 → 재사용 안 하고 단순 원장을 따로 둔다.
- 재시도: 기존 `app/api/cron/hiring-upload-cleanup/route.ts`에 원장 처리 몇 줄 추가(오래된 순 20건, `removeCleanupFiles` 100개 청크, 성공 시 삭제, 실패 시 attempts+1). Supabase remove는 없는 경로도 성공 → 재시도 안전.

### 3. 공용 삭제 함수 `src/lib/hiring/delete.ts`

`deletePosting(spaceId, postingId)` / `deleteApplications(spaceId, ids)` — 둘 다 `prisma.$transaction` 하나:

1. **잠금**: 공고 `SELECT … FOR UPDATE`(spaceId 스코프) → 트랜잭션 안에서 `getPostingDisplayStatus` 재검사, OPEN이면 409 (Codex 지적: 검사↔삭제 사이 경쟁). 새 지원서 INSERT는 공고 FK의 KEY SHARE 잠금과 충돌해 직렬화 → 잠금 후 조회하는 파일 목록에 이미 커밋된 지원서가 모두 포함되고, 이후 INSERT는 FK 실패. 지원자 삭제는 `HiringApplication … FOR UPDATE`.
2. **경로 수집**: `HiringApplicationFile.filePath` + 대상 `HiringUploadSession.files[].path`(공고 삭제 시 `postingId`, 지원자 삭제 시 `applicationId`).
3. **업로드 세션 삭제**: 공고/지원서에 연결된 `HiringUploadSession` delete (Codex 지적: 세션이 SetNull로 남아 PII 잔존). 기존 BEFORE DELETE 트리거가 `HiringUploadCleanup`에도 경로를 기록 → 진행 중 서명 업로드가 삭제 후 올라와도 기존 cleanup cron이 3시간 뒤 정리(이중 삭제는 무해).
4. **이관 원장 tombstone** (결정: 삭제 허용 + 사본 비움): `HiringMigrationRecord` 중 `targetModel IN ('HiringPosting','HiringApplication')` 이고 삭제 대상 id인 행 → `sourceSnapshotEnc/Iv = null`, `metadata = {…기존, deletedAt}`. 행은 남겨 재이관 시 되살아나지 않게 함.
5. **DB 삭제**: `hiringPosting.delete` / `hiringApplication.deleteMany({ id in ids, spaceId })` (Cascade로 파일·메모·알림·매장 연결 삭제).
6. **원장 기록**: 경로가 있으면 `HiringFileDeletion` insert.

- 커밋 후 `processFileDeletion(row)` 즉시 1회 시도(실패해도 응답은 성공 — 파일은 cron이 책임).
- 이관 코드(`ledger.ts`·import·recovery)는 **이 브랜치에서 수정하지 않음** — 오프닝 이관은 별도 작업줄(`feat/opening-customer-migration`, migration 디렉터리 15파일 차이). 현재도 대상이 없으면 `Migration target conflict`로 실패(fail closed) → 재이관으로 되살아나지 않음.
  - 영향: tombstone(스냅샷 null)은 `decodeMigrationSnapshot`이 throw → `runtime-audit`·`opening-auto-backfill`은 레코드별 try/catch라 "해독 실패"로 집계, `posting/application-recovery`는 해당 건 실패. `application-history`는 지원서가 없으면 먼저 `absent` 반환이라 무관. `reencrypt-run`은 `iv='v1'` 행만 조회해 null 무관. → 이관 담당에게 "`metadata.deletedAt` 있는 record는 건너뛰기" 반영 요청 메모.
- 트랜잭션 `timeout: 30_000` 명시(지원자 많은 이관 공고 — 세션 BEFORE DELETE 트리거·cascade). 잠금은 raw `FOR UPDATE`; 발행 경로의 조건부 UPDATE도 같은 행 잠금이라 직렬화됨.
- `HiringFileDeletion` 행당 경로 100개 이하로 나눠 insert(재시도 단위 작게). 재시도 cron `/api/cron/hiring-upload-cleanup`은 `vercel.json`에 5분 주기로 등록돼 있음(확인).

### 4. API

- `DELETE /api/hiring-posts/postings/[id]`: `assertRole(ADMIN)` + `deletePosting`. OPEN → 409 `모집중인 공고는 삭제할 수 없어요. 먼저 마감 처리한 뒤 삭제해 주세요.` 응답 `{ ok, deletedApplications }`.
- `DELETE /api/hiring-applicants/applications/[id]` 신규, `DELETE /api/hiring-applicants/applications/bulk` 신규(body `{ids}`, bulk PATCH의 ids 스키마·최대 개수 재사용). 세 라우트 모두 `resolveDeckContext('recruiting',{write:true})` + `assertRole(ADMIN)`(기존 공고 DELETE는 write 옵션 없음 → 맞춤. 구독 만료 시 삭제도 다른 쓰기처럼 차단). 다른 space id는 조용히 제외, 응답 `{ deleted }`.

### 5. 화면

- 페이지(server)에서 `canDelete = role in (OWNER, ADMIN)` 계산해 prop 전달(`canExportExcel`과 같은 방식).
- 공고: `postings-table.tsx` 행 `…` 메뉴 "삭제", `posting-detail.tsx` 헤더 "삭제". OPEN → 안내 AlertDialog만. 그 외 → 확인 AlertDialog(제목, "지원자 N명과 첨부 파일도 함께 삭제되며 되돌릴 수 없어요") → DELETE → 목록 이동/refresh. 지원자 수는 목록·상세 기존 데이터에 있으면 재사용, 없으면 상세 server에서 count.
- 지원자: 상세 헤더(BlacklistButton 옆) "삭제" → 확인 → 목록. 목록 FloatingActionBar "삭제"(선택 N명) → 확인 → bulk DELETE → 선택 해제·refresh.
- 기존 AlertDialog 패턴, `workdeck-ui` 스킬·DESIGN.md 준수.

### 6. Shift 연속 선택

- `applications-table.tsx`에 이미 구현(`applyRangeSelection`). 브라우저에서 동작 확인만, 깨져 있으면 수정.

## 검증

- 테스트(작게, 기존 hiring e2e 패턴):
  - 공고 삭제 — OPEN 409, CLOSED·DRAFT·마감일 지난 ACTIVE 성공, MEMBER 403, 다른 space 404; 지원자·파일·업로드 세션 행 삭제, `HiringFileDeletion`에 경로 기록, 이관 record tombstone(스냅샷 null).
  - 지원자 bulk 삭제 — 다른 space id 제외, MEMBER 403, 경로 원장 기록.
  - Storage 실패 모의 → 응답 성공·원장 행 유지·attempts 증가(cron 처리 함수 단위).
  - 동시성: 삭제 트랜잭션 중 같은 공고 지원 INSERT → FK 실패 또는 삭제 범위 포함(잠금 순서 테스트 1개).
  - (이관) tombstone된 record는 현재 재이관 시 건너뛰지 않고 **실패로 닫힘**(`Migration target conflict`, 부모 공고 스냅샷 해독 실패) — 되살아나지 않음은 보장, 건너뛰기는 이관 담당 작업.
- `npx tsc --noEmit`, `npm run lint`, 관련 jest.
- dev DB migration 적용 → ARCHIVED 행 CLOSED 확인.
- 브라우저(dev): 공고 삭제(모집중 안내/마감 삭제), 지원자 상세·일괄 삭제, Shift 선택, MEMBER 버튼 숨김.
- 운영 배포 후: 해당 공고(cmwhyrwih…) 마감 표시 확인, `HiringFileDeletion` 잔여 0 확인.

## 위험 · 롤백

- 삭제는 되돌릴 수 없음 → ADMIN 제한 + 확인 창 + 트랜잭션 원자성.
- ARCHIVED→CLOSED 변환은 원래 "보관" 표시 정보만 잃음(지원자·공고 데이터 그대로). 롤백 시 enum 값이 남아 있어 코드 revert만으로 동작(어느 공고가 보관이었는지는 복원 불가 — migration 전 id 목록을 배포 기록에 남김, 운영 읽기 조회는 에디 승인 필요).
- 코드 롤백: revert PR. 원장 테이블은 남아도 무해.

## Codex 리뷰 반영 (adversarial-review 2026-11-26, 지적 5건 — 반영 5)

1. [critical] Storage 선삭제 데이터 유실 → DB 트랜잭션 + 파일 삭제 원장 + cron 재시도로 변경.
2. [high] 상태 검사↔삭제 경쟁 → 트랜잭션 안 FOR UPDATE 잠금 후 재검사.
3. [high] 업로드 세션·정리 원장 누락 → 세션 삭제 포함(기존 트리거가 cleanup 원장 기록).
4. [high] 이관 원장 PII·재이관 → tombstone(사본 비움) + ledger.ts 삭제 처리.
5. [high] enum 제거 배포 충돌 → enum 값 유지, 데이터만 변환.

## 구현 후 코드 리뷰 반영 (opus code-reviewer, 지적 8건 — 반영 6, 보류 2)

1. [high] `HiringFileDeletion` RLS 누락 → 원장 생성 migration 안에 ENABLE RLS + REVOKE anon/authenticated 추가(migration-rls-lint 규칙: 같은 migration).
2. [medium] cron 업로드 정리 실패 시 원장 재시도 건너뜀 → catch 경로에서도 `processFileDeletions` 실행.
3. [medium] postingId SetNull 된 세션 누락 → 세션 조회에 `applicationId in 지원서들` OR 추가.
4. [low] 즉시 시도·cron 경합 P2025 → `deleteMany`로 멱등 처리.
5. [low] metadata가 객체가 아닐 때 jsonb 병합 → `jsonb_typeof='object'` 가드.
6. [low] 재이관 동작 문서 불일치 → 검증 항목을 "실패로 닫힘"으로 정정. 건너뛰기 처리·테스트는 이관 작업줄로 보류(이 브랜치에서 migration 코드 비수정 원칙).
7. [low] 공고 이미지(hiring-assets 공개 버킷) 고아 파일 → 보류: 지원자 PII 아님, 범위 밖.
8. [low] `?status=ARCHIVED` 북마크 → 마감 목록으로 매핑.
