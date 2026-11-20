# 사용자가 새 작업 공간(Space) 만들기

- 날짜: 2026-11-20
- 와이어프레임(승인): `docs/design/plans/user-create-space/plan.md`, `wireframe.png`
- 선행: 어드민 「새 Space 만들기」 #1530/#1531 (`app/api/admin/users/[id]/spaces/route.ts`)

## 목표

로그인 사용자가 사이드바 작업 공간 카드에서 자신이 OWNER 인 새 Space 를 만든다. 지금은 가입 시 1개(`ensureWorkspaceForUser`)와 어드민 생성만 있다.

## 확정 결정 (grill 2026-11-20)

1. **체험은 OWNER 사용자당 업무별 1회.** 업무를 켤 때 그 Space 의 OWNER 가 OWNER 인 _다른_ Space 에 같은 업무의 `SpaceDeckAccess.trialEndsAt` 이 있으면 체험을 시작하지 않는다(→ 구독 필요). 스키마 변경 없음.
2. **OWNER Space 5개까지**(사용자 직접 생성만 막음, 어드민 생성은 상한 없음). 상수 `MAX_OWNED_SPACES = 5`.
3. 진입점: 사이드바 작업 공간 카드(`SpaceSwitcher`)를 Space 1개여도 열리게, 메뉴 맨 아래 「＋ 새 작업 공간 만들기」 → 이름 Dialog → 생성 후 기존 `switchTo(newId)` 로 전환(`/my-deck` 이동). 업무 추가는 기존 화면.
4. 오프닝 이전 대기 job: 어드민과 같은 무효화(`MULTIPLE_OWNER_SPACES` BLOCKED). 로직을 공용 함수로 추출해 두 경로가 공유.
5. 어드민 생성 Space 의 「모집 관리 켜기」는 지금처럼 체험 허용(1회 규칙 미적용).

## 변경 파일

| 파일                                                   | 변경                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/spaces/create-owned-space.ts` (신규)          | 어드민 route 의 tx 본문 추출: `createOwnedSpaceInTx(tx, { userId, name, maxOwned?: number })` → `{ duplicateSpaceId } \| { limitReached: true } \| { space, blockedJobs }`. lock(`lockOwnerSpaces`) → 같은 이름 검사 → (maxOwned 있으면) 개수 검사 → create(PERSONAL, OWNER) → OWNER>1 이면 job 무효화(재시도 루프 그대로). 업무 켜기·감사 로그는 호출자 몫 |
| `app/api/admin/users/[id]/spaces/route.ts`             | 공용 함수 사용. 응답·감사 로그·`enableDeckInTx(..., { trialOncePerOwner: false })` 동작 불변                                                                                                                                                                                                                                                                |
| `app/api/spaces/route.ts`                              | `POST` 추가: `requireUser`/세션 사용자, body `{ name }`(어드민 `createSpaceSchema` 의 name 규칙 재사용 — trim·NFC·1~60자). `maxOwned: 5`. 201 `{ space }` / 409 같은 이름 `{ spaceId }` / 409 `SPACE_LIMIT` / 422 / 401                                                                                                                                     |
| `src/lib/billing/entitlement.ts`                       | `findTrialUsedElsewhere(spaceId, deckAppIds, db)`: 이 Space 의 OWNER userId 들 → 그들이 OWNER 인 다른 Space 의 `spaceDeckAccess` 중 `trialEndsAt not null` 인 deckAppId 집합. `ensureTrialStarted(spaceId, deckAppId, db, { trialOncePerOwner = true })` — true 면 집합에 있으면 체험 시작 안 함                                                            |
| `src/lib/spaces/enable-deck.ts`                        | `enableDeckInTx(tx, spaceId, deckAppId, opts?)` 옵션 전달. 체험 판정 전에 이 Space 의 OWNER 마다 `lockOwnerSpaces(tx, ownerId)`(id 정렬 순) — 같은 사용자의 두 Space 에서 동시에 업무를 켜 체험 2회가 나는 경합 차단. 어드민 route 는 이미 같은 키 lock 을 잡고 있어 재진입 안전(xact lock 은 같은 tx 재획득 허용)                                          |
| `app/my-deck/page.tsx`                                 | billing 항목에 `trialUsedElsewhere: boolean` 추가(위 함수 1회 호출)                                                                                                                                                                                                                                                                                         |
| `src/components/my-deck/my-deck-client.tsx`            | `startsTrial` 이 `trialUsedElsewhere` 면 false → 기존 `needsSubscription` → `openSubscribe` 흐름. 구독 대상에 `trialUsedElsewhere` 전달. `confirmAddDeck` 이 402(`DECK_SUBSCRIPTION_REQUIRED`)를 받으면(화면을 연 뒤 다른 공간에서 체험 소진) `router.refresh()` 후 OWNER 는 `openSubscribe`, 아니면 기존 토스트                                            |
| `app/api/spaces/decks/route.ts`                        | 402 응답 본문에 `code: 'DECK_SUBSCRIPTION_REQUIRED'` (이미 있으면 그대로)                                                                                                                                                                                                                                                                                   |
| `src/components/billing/subscribe-dialog.tsx`          | `trialUsedElsewhere` 면 「다른 작업 공간에서 이 업무 체험을 이미 사용했습니다.」 한 줄                                                                                                                                                                                                                                                                      |
| `src/components/layout/space-switcher.tsx`             | `SpaceSwitcher` 는 항상 DropdownMenu. 맨 아래 구분선 + 「＋ 새 작업 공간 만들기」(소유 5개면 disabled + 안내). 선택 시 `CreateSpaceDialog` 열기. `SpaceContext`(홈 맥락 줄) 불변                                                                                                                                                                            |
| `src/components/layout/create-space-dialog.tsx` (신규) | 이름 입력 Dialog(60자, 안내 3줄). 201 → `switchTo(id)`; 409 같은 이름 → 입력란 아래 오류; 409 상한 → 안내; 기타 → 오류 문구                                                                                                                                                                                                                                 |
| 테스트                                                 | 공용 함수·POST route·`ensureTrialStarted` 1회 규칙(다른 OWNER Space 체험 있음/없음/어드민 옵션)·switcher(1개여도 메뉴, 5개 disabled)·dialog                                                                                                                                                                                                                 |

## 단계

1. 공용 함수 추출 + 어드민 route 교체 → 기존 어드민 테스트 그대로 통과 확인(동작 불변).
2. 체험 1회 규칙(`findTrialUsedElsewhere`, `ensureTrialStarted` 옵션, `enableDeckInTx` lock·옵션) + 테스트.
3. `POST /api/spaces` + 테스트.
4. UI: switcher 메뉴·Dialog·my-deck `trialUsedElsewhere`·구독 모달 문구 + 테스트.
5. 실 DB 통합 테스트(`src/lib/__tests__/user-create-space.e2e.test.ts`, `jest -c jest.config.e2e.ts`, `PRISMA_POOL_MAX=1`): ① 같은 OWNER 의 두 Space 에서 같은 업무 `enableDeckInTx` 동시 실행 → 체험 정확히 1건·다른 쪽 DECK_SUBSCRIPTION_REQUIRED, ② 소유 4개 상태에서 생성 동시 2건 → 정확히 1건 성공, ③ 생성과 업무 켜기 동시 → 데드락·timeout 없이 완료. 모든 tx 내부 조회가 전달된 tx 만 쓰는지 pool=1 로 확인.
6. tsc·eslint·jest, dev 서버에서 실제 흐름(1개 계정 → 생성 → 전환 → 체험한 업무 추가 시 구독 모달) Playwright 확인.
7. 코드 리뷰(opus + codex:review) → develop → main(release 브랜치, main 기준 tsc).

## 검증

- 단위: 위 테스트. 특히 어드민 경로는 체험 시작(옵션 false), 사용자 경로는 다른 OWNER Space 체험 이력이 있으면 `DECK_SUBSCRIPTION_REQUIRED`.
- dev DB: 테스트 계정으로 Space 생성 → 체험 이력 있는 업무 추가 시 402/구독 모달, 이력 없는 업무는 체험 시작. 6번째 생성 409.
- 운영 영향 확인: 현재 OWNER Space 2개 이상 사용자는 대성산업 고객 1명(체험 이미 시작) — 기존 체험 기간은 바뀌지 않음(이미 `trialEndsAt` 있으면 함수가 일찍 반환).

## 위험·롤백

- 스키마 변경 없음 → 코드 롤백은 revert 배포. 단 revert 해도 사용자가 이미 만든 Space(정상 고객 데이터라 지우지 않음)와 BLOCKED(`MULTIPLE_OWNER_SPACES`) job 은 남는다. job 은 기존 오프닝 큐 절차로 처리: 운영자가 대상 Space 를 확인해 수동 이전(대성산업과 같은 manual import) 후 `opening-auto-backfill --close-job`. 승인 정보(approvedBy/At/Snapshot) 삭제는 어드민 경로와 같은 의도된 동작 — 대상이 바뀔 수 있어 재승인 필수.
- 사용자 생성으로 job 이 BLOCKED 되면 서버 로그에 `space.create.user`(userId·spaceId·blockedJobs 수, PII 없음)를 남기고 운영자는 어드민 오프닝 큐 「차단」 탭(사유 `MULTIPLE_OWNER_SPACES`)에서 식별. Slack 알림은 워커 스크립트에만 있어 앱 경로엔 추가하지 않음(어드민 생성과 동일).
- 체험 1회 규칙은 기존 사용자 첫 Space 에도 적용되지만 다른 OWNER Space 가 없으면 결과 동일.
- 결제 일시 중지(`BILLING_CHECKOUT_PAUSED`) 중엔 LOCKED 대신 PAUSED 로 허용되므로 체험 미부여여도 이용 가능 — 기존 정책과 동일.
- 남용: 체험은 사용자당 1회지만 다른 이메일로 새 가입하면 새 체험 — 기존과 같은 수준, 이번 범위 밖.

## 범위 밖

- Space 삭제·이름 변경(사용자), OWNER 이전, Workspace(쿠팡) 연결.

## Codex 리뷰 (adversarial-review 2026-11-20): 지적 4건 — 반영 3, 보류 1

1. [high] 현재 OWNER 관계만으로는 OWNER 변경 시 체험 이력이 사라짐 → **보류**: 사용자 경로는 OWNER 를 바꾸거나 지울 수 없다(`app/api/spaces/members/[memberId]` 가 OWNER 대상 400). OWNER 변경은 운영자 콘솔(`/api/admin/users/[id]/memberships`)뿐이라 남용 경로가 아님. 사용자별 체험 원장 테이블은 스키마 추가 비용 대비 이득 없음 — 운영자 OWNER 변경 시 체험 재부여 가능성은 알려진 한계로 둔다.
2. [high] revert 로 생성 Space·무효화 job 복구 불가 → **반영**: 위험·롤백에 절차(Space 유지, BLOCKED job 은 큐 수동 처리)와 식별용 로그 추가(큐 차단 탭으로 식별).
3. [medium] 화면 연 뒤 체험 소진 시 402 를 구독 흐름으로 못 넘김 → **반영**: `confirmAddDeck` 402 처리.
4. [medium] 실 DB·pool=1 경합 검증 부재 → **반영**: e2e 3건(단계 5).

## 코드 리뷰 (2026-11-20, 791ba53f)

Codex review: 지적 2건 — 반영 1, 보류 1

- [P1] 새 Space 에 쿠팡 Workspace 연결 불가 → **보류**: 계획 범위 밖(아래). 쿠팡 업무는 운영에서 「준비중」이라 새 Space 에서 켤 수 없고, 어드민 생성 Space 도 같은 상태.
- [P2] 생성 후 전환 실패 시 재시도 경로 없음 → **반영**: `switchTo` 가 결과를 돌려주고 실패하면 toast(접힌 사이드바 포함), Dialog 는 다시 마운트해 입력 초기화.

opus code-reviewer: 9건(CRITICAL·HIGH 0) — 반영 5, 문서화 3, 보류 1

- 402 문구가 원인과 무관하게 「다른 공간에서 체험 사용」 → 반영: 402 본문에 서버 판정 `trialUsedElsewhere` 를 싣고 그대로 표시.
- 접힘 상태 전환 실패 무표시·Dialog 입력 잔존 → 반영(위 P2와 동일 수정).
- 상한 안내가 키보드로 닿지 않음 → 반영: `disabled` 대신 `aria-disabled` + 선택 차단.
- 어드민 route 의 `limitReached` 분기 500 → 반영: 409 `SPACE_LIMIT`.
- e2e 가 `BILLING_CHECKOUT_PAUSED` 에 흔들림 → 반영: beforeAll 에서 해제. 공유 dev 행 일시 변경은 수동 실행 전용 테스트라 유지(afterAll 복원, 기본 jest·pre-push 제외).
- 문서화(의도된 정책): ① 어드민이 준 체험도 "그 사용자의 체험 1회"로 센다 — 같은 OWNER 의 기존 Space 에서 같은 업무를 나중에 켜면 체험 없이 구독(필요 시 `billing-admin set-trial`). ② 체험 없이 바로 유료 구독한 업무는 이력이 없어 다른 Space 에서 체험 가능 — 남용 이득 없음. ③ Prisma `User` 행 없는 세션의 직접 API 호출은 500 — UI 경로로는 도달 불가.
