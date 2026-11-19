# 어드민 「사용자에게 새 Space 만들기」 계획

작성: 2026-11-20. 브랜치 `feat/admin-create-space`(origin/develop 기준).

## 목표

운영자가 어드민 사용자 상세에서 기존 사용자를 OWNER 로 하는 새 Space 를 만든다. 첫 용도는 오프닝 대성산업(#510) 이전 — 디에스인(#511)을 이미 받은 같은 고객 계정에 두 번째 Space 를 붙인다(사용자 결정 「A. 같은 계정에 Space 추가」, 오프닝에서 두 작업공간을 각각 결제해 씀).

지금은 사용자도 어드민도 Space 를 새로 만들 경로가 없다. 가입 때 `ensureWorkspaceForUser`(src/lib/workspace.ts)가 PERSONAL Space 하나를 만드는 것뿐이다.

## 현재 코드 사실

- `Space { id, name, type: PERSONAL|ORGANIZATION }`, 구성원은 `SpaceMember(role OWNER|ADMIN|MEMBER)`, 업무는 `DeckInstance(spaceId, deckAppId, isActive)`, 체험·면제는 `SpaceDeckAccess`, 구독은 `SpaceSubscription`(Space 단위).
- 현재 Space 결정(`src/lib/spaces/current-space.ts`): `?spaceId` → 쿠키 `wd_space` → OWNER 중 가장 오래된 멤버십 → 가장 오래된 멤버십. 여러 Space 전환 UI 는 #1426 으로 있다.
- 레거시 `Workspace`(쿠팡 광고)는 사용자당 1개(`ownerId @unique`), `spaceId @unique`. `ensureWorkspaceForUser` 는 `Workspace.spaceId` 가 비었을 때만 "Workspace 가 없는 가장 오래된 OWNER Space" 를 연결한다 → 이미 연결된 사용자는 새 Space 가 생겨도 연결이 바뀌지 않는다.
- 어드민 사용자 상세에는 이미 「기존 Space 에 구성원 추가」(`POST /api/admin/users/[id]/memberships/[spaceId]`, requireOperator + writeAuditLog)가 있다. 개인 Space 에 구성원을 넣으면 ORGANIZATION 으로 바꾸는 규칙이 있다.
- 업무 켜기(`POST /api/spaces/decks`)는 `ensureTrialStarted` → `canUseDeck` → `DeckInstance` 생성을 한 트랜잭션으로 한다. 준비중 업무는 `findClosedDecks` 로 막는다.

## 설계

### API — `POST /api/admin/users/[id]/spaces`

- 본문 `{ name: string(1~60, trim), enableRecruiting?: boolean(기본 true) }` (zod, `src/lib/validations/admin-users.ts` 에 스키마 추가).
- **중복 방지(Codex 1차 #3·2차 #2)**: 화면 상태(요청 ID)에 기대지 않는다. 트랜잭션 첫머리에 `pg_advisory_xact_lock(hashtext(userId)) — ensureWorkspaceForUser 와 같은 키(Codex 코드 리뷰)` 로 사용자 단위 직렬화 후, 그 사용자가 OWNER 인 Space 중 같은 이름(trim·NFC 비교)이 있으면 만들지 않고 **409 + 기존 spaceId** 를 돌려준다. 응답 유실·새로고침·동시 제출 뒤 재시도해도 1개만 생기고, 운영자는 409 응답의 Space ID 로 결과를 확인한다.
- 첫 줄 `requireOperator()`(비운영자 404 은닉, MFA aal2 기존 규칙 그대로).
- 사용자 존재 확인(404). 탈퇴(User 행 없음)는 404, 정지(ban) 사용자는 409, 인증 상태 조회 실패는 502 로 거부.
- 한 트랜잭션:
  1. `space.create({ name, type: 'PERSONAL', members: { create: { userId, role: 'OWNER' } } })` — 가입 경로와 같은 타입. 나중에 구성원을 넣으면 기존 규칙대로 ORGANIZATION 으로 바뀐다.
  2. `enableRecruiting` 이면 `/api/spaces/decks` 와 같은 순서로 `findClosedDecks` 확인 → `ensureTrialStarted(space, 'recruiting', tx)` → `canUseDeck` → `deckInstance.create`. 준비중이면 403, 구독이 필요하면 402 로 트랜잭션 전체 롤백. 공용 함수 안의 `findClosedDecks` 는 tx 클라이언트를 받아(순차 조회) 풀 크기 1에서도 교착하지 않는다. advisory lock 은 `$executeRaw`(void 컬럼은 `$queryRaw` 로 역직렬화 불가).
  3. **진행 중 이전 job 무효화(Codex 2차 #1)**: 생성 후 이 사용자의 OWNER Space 가 **2개 이상일 때만**, 같은 tx 에서 `OpeningMigrationJob` 중 `MATCHED·PLANNED·APPROVED` 와 `BLOCKED` 이면서 사유가 정확히 `[NO_TARGET_SPACE]` 인 job 을 `BLOCKED`(blockReasons 에 `MULTIPLE_OWNER_SPACES` 추가, approvedBy·approvedAt·approvedSnapshot 비움)로 바꾼다. 적용이 시작된 상태(APPLYING 이후)는 건드리지 않고 응답에 건수로 알린다.
  4. `writeAuditLog(operator, 'space.create', 'space', space.id, { ownerUserId, name, enableRecruiting, blockedJobs })` — 같은 tx(`writeAuditLog` 는 tx 인자 지원, #1517).
- 승인 API(`POST /api/admin/opening-migrations/[id]` approve)도 **같은 사용자 단위 advisory lock(`hashtext(userId)`, 가입 경로와 같은 키)을 잡은 tx 안에서** job 사용자의 OWNER Space 수를 다시 세어 2개 이상이면 409(`MULTIPLE_OWNER_SPACES`). Space 생성과 승인이 직렬화된다(Codex 3차). 워커가 그 사이 만든 job 은 다음 계획 때 `pickTargetSpace` 가 다중 OWNER 로 보고 원본을 읽지 않는 짧은 경로로 `MULTIPLE_OWNER_SPACES` 만 기록하고, 이미 PLANNED 로 저장된 job 은 이 승인 재확인에서 막힌다. 1차는 적용이 수동이라 적용 직전 검증은 수동 절차(운영자가 대상 Space 를 명시)로 대신한다.
- 응답 `{ space: { id, name } }` 201.
- 업무 켜기 로직은 `/api/spaces/decks` POST 와 중복되지 않게 공용 함수(`src/lib/spaces/enable-deck.ts`의 `enableDeckInTx(tx, spaceId, deckAppId)`)로 빼서 두 곳이 쓴다. 기존 사용자 경로 동작은 바꾸지 않는다(테스트로 고정).

### 어드민 화면

- `src/components/admin/user-detail.tsx` 의 「Space 멤버십」 카드 하단에 입력 1개(Space 이름) + 체크박스(「모집 관리 켜기」 기본 체크) + 버튼 「새 Space 만들기」. 기존 「Space 에 추가」 옆 같은 패턴이라 ui-plan 대상이 아니다(기존 패턴에 필드·버튼 추가).
- 누르면 확인(`confirm`) 후 POST(`fetchWithMfa`), 성공 시 목록 새로고침과 함께 **생성된 Space ID 를 화면에 표시**(이전 대상 확인용). 409(같은 이름 존재)는 기존 Space ID 를 보여 준다. 실패는 기존 카드와 같은 토스트/메시지.

## 영향 검토

| 영역                  | 영향                                                                                                                                                     | 조치                                                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 Space 선택       | 쿠키가 없으면 "가장 오래된 OWNER Space" — 새 Space 는 뒤에 생기므로 기존 기본 Space(디에스인)가 그대로 열린다                                            | 없음. 고객은 Space 전환 UI(#1426)로 이동. 완료 메일에 안내                                                                                                                                                                                    |
| 레거시 Workspace 연결 | 이미 연결된 사용자는 바뀌지 않음(`spaceId: null` 일 때만 채움). 쿠팡 광고 전용                                                                           | 없음(테스트로 고정: 두 번째 OWNER Space 생성 뒤 `ensureWorkspaceForUser` 재호출해도 기존 연결 유지)                                                                                                                                           |
| 결제·entitlement      | Space 단위라 새 Space 는 독립. 모집 관리 체험은 `ensureTrialStarted` 로 새로 시작(첫 체험 1회 규칙은 Space 별)                                           | 보장가는 이전 후 `migrate-grant <새 Space>` 로 기존 절차                                                                                                                                                                                      |
| 오프닝 이전 워커      | `pickTargetSpace` 는 "모집 관리가 켜진 OWNER Space 중 가장 오래된 곳"이라, 기존 Space 의 모집 관리가 꺼져 있으면 새 Space 가 대상이 될 수 있다(Codex #1) | **OWNER Space 가 2개 이상인 사용자는 자동 선택하지 않고 `MULTIPLE_OWNER_SPACES` 로 차단**(auto-job `pickTargetSpace`·`classifyPlan` + 테스트). 운영자가 수동 흐름으로 대상을 정한다. 510 은 수동 흐름으로 이전 후 job 을 DONE 으로 갱신(아래) |
| 모집 관리 체험 시작   | `enableRecruiting` 은 생성 시점에 7일 체험을 시작한다 → 이전·승인 절차가 길어지면 고객이 받기 전에 줄어든다(Codex #4)                                    | 이전 완료 후 `migrate-grant`(보장가) 다음, **완료 메일 발송일 기준 +7일로 `billing-admin set-trial`**(기존 도구, lockedPrice 가 있어야 동작) — 운영 쓰기라 메일 초안과 함께 승인받는다                                                        |
| 사용자 삭제(어드민)   | "유일한 멤버인 Space 도 함께 삭제" 규칙에 새 Space 도 포함                                                                                               | 기존 동작 그대로                                                                                                                                                                                                                              |
| Space 이름 중복       | 고유 제약 없음                                                                                                                                           | 허용                                                                                                                                                                                                                                          |

## MULTIPLE_OWNER_SPACES 출구

- 워커: 사유가 정확히 `[MULTIPLE_OWNER_SPACES]` 인 BLOCKED job 도 재시도 조회에 포함한다. 사용자 OWNER Space 가 여전히 2개 이상이면 touch 만 하고, 1개로 줄면 재계획한다.
- 수동 이전을 마친 job 은 `opening-auto-backfill.ts --close-job`(별칭 `--from-held`)으로 DONE 처리한다. 대상은 HELD(userId 없음) 또는 `MULTIPLE_OWNER_SPACES` 로 막힌 BLOCKED 이며 기존 status 를 조건으로 건다. 이미 DONE 인데 targetSpaceId 가 `--space` 와 다르면 오류, 기존 `summary.reason` 은 `previousReason` 으로 보존한다.

## 510 job 처리(Codex #5)

510 은 11-18 backfill 로 `HELD`(SIBLING_OF_511) 행이 있다. `scripts/opening-auto-backfill.ts` 에 `--close-job`(별칭 `--from-held`) 옵션을 추가해 저장소 도구로 처리한다.

- 조건: 기존 job 이 `HELD` 이고 `userId` 가 null(backfill 행)일 때만. 원장 대조는 DONE 과 같은 규칙(이 브랜드 원장 행의 Space 집합 = 정확히 `{--space}`) — apply 가 끝나 원장이 있어야 통과한다.
- 갱신: 조건부 `updateMany(where {openingBrandId, status:'HELD', userId:null})` → `status DONE, targetSpaceId, blockReasons [], contactHits null, summary { backfilled:true, reason, previous:'HELD', updatedFromHeldAt }`. count≠1 이면 실패(재실행 안전 — 이미 DONE 이면 `EXISTS_DONE` 보고).
- 기본 dry-run, `--apply` 때만 쓰기. 테스트 추가.
- apply 성공 후 job 갱신이 실패하면: 이전 데이터는 원장에 남아 있으므로 원인을 고친 뒤 `--from-held --apply` 를 다시 돌리면 된다(멱등).

## 단계

1. `enableDeckInTx` 추출 + `/api/spaces/decks` 가 사용(동작 불변 테스트).
2. 스키마·API·감사 로그 + 테스트(비운영자 404, 정지 사용자 409, 정상 생성 201 + OWNER 멤버십 + recruiting DeckInstance + SpaceDeckAccess 체험, 준비중 업무면 전체 롤백, 감사 로그 같은 tx, 같은 이름 재요청 409+기존 id·동시 2회 1개, 진행 중 job BLOCKED 무효화·APPLYING 이후 미변경, 승인 API 의 다중 OWNER 409, `ensureWorkspaceForUser` 재호출 시 기존 Workspace 연결 유지).
   2-1. 워커 `pickTargetSpace`: OWNER Space 2개 이상이면 `MULTIPLE_OWNER_SPACES` 차단 + 테스트, 어드민 큐 라벨 추가.
   2-2. `opening-auto-backfill.ts --from-held` + 테스트.
3. 어드민 화면 입력·버튼 + 컴포넌트 테스트.
4. tsc·eslint·관련 jest → opus 코드 리뷰 → develop → main 릴리스.
5. (승인 후) 운영에서 대상 사용자에게 「대성산업」 Space 생성(모집 관리 켬) → 510 prepare·dry-run 보고 → (승인 후) apply → `--from-held` 로 job DONE → migrate-grant → 메일 초안 + 체험 종료일(set-trial 발송일+7일) 승인 → 발송.

## 검증

- 위 단위·API 테스트, 기존 `/api/spaces/decks` 테스트 통과.
- dev 실화면: 운영자 계정으로 테스트 사용자에게 Space 생성 → 사용자로 로그인해 Space 전환 UI 에 두 Space 가 보이고 새 Space 에 모집 관리가 켜져 있는지.

## 롤백

- 코드: 새 라우트·버튼 제거(데이터 변경 없음). 공용 함수 추출은 동작 불변.
- 운영(Codex #2): 마지막 OWNER 멤버십은 기존 API 가 지우지 못하므로 멤버십 제거로는 롤백하지 않는다. 잘못 만든 Space 는 **이전 데이터가 들어가기 전**(apply 전)에만, 승인 후 1회성 확인 스크립트로 삭제한다 — 조건: 생성 감사 로그(`space.create`)의 Space 이고, 구성원이 그 OWNER 1명뿐, `HiringMigrationRecord`·`HiringPosting`·`HiringDetailTemplate`·`SpaceSubscription`·`BillingMethod` 0건. 남는 것은 생성 때 만든 `DeckInstance`·`SpaceDeckAccess` 뿐이고 Space cascade 로 함께 지워진다. 삭제 결과는 감사 로그 `space.delete` 로 남긴다. apply 뒤에는 Space 를 지우지 않고 원장 기준 정리(별도 승인).

## 범위 밖

사용자가 직접 Space 를 만드는 화면, Space 이름 변경·삭제 UI, 레거시 Workspace 재연결.

## Codex 적대적 검토(2026-11-20) — 지적 5건: 반영 5

1. 새 Space 가 워커 대상이 될 수 있음 → OWNER Space 2개 이상이면 `MULTIPLE_OWNER_SPACES` 차단.
2. 멤버십 제거 롤백 불가 → apply 전에만 조건 확인 스크립트로 삭제, 이후는 원장 기준 정리.
3. 재시도 중복 생성 → 사용자 단위 advisory lock + 같은 OWNER·같은 이름이면 409(기존 id) (2차에서 requestId 방식 대체).
4. 체험 조기 소진 → grant 후 발송일+7일 set-trial(승인).
5. 1회성 job 갱신 → `opening-auto-backfill.ts --from-held`(조건부·멱등·테스트).

## Codex 적대적 검토 2차 — 지적 2건: 반영 2

1. 이미 계획·승인된 job 은 차단을 안 거침 → Space 생성 tx 에서 MATCHED·PLANNED·APPROVED 무효화(BLOCKED MULTIPLE_OWNER_SPACES) + 승인 API 재확인.
2. 새로고침 후 멱등 키 소실 → 화면 키 대신 서버 규칙(같은 OWNER·같은 이름이면 409+기존 id, 사용자 단위 lock).

## Codex 적대적 검토 3차 — 지적 1건: 반영 1

1. Space 생성과 job 승인 경합 → 승인 API 가 같은 사용자 lock 안에서 OWNER 수 재확인(동시성 테스트: lock 순서 모킹으로 생성 후 승인 409).
