# 쿠팡 가격 쓰기 v1 — 후속 과제

**작성** 2026-09-23 · **대상 브랜치** `coupang-ads/wip` (스펙 `../prd/PRD_PRICE_WRITE_V1.md`, 계획 `docs/superpowers/plans/2026-09-22-coupang-price-write.md`)

구현 중 리뷰에서 나왔으나 v1 머지 전에 고치지 않기로 한 항목들. 최종 전체 브랜치 리뷰의 분류를 그대로 옮긴다. 머지 전 수정으로 분류된 것들은 이미 반영됐으므로 여기 없다.

## 지금 곧 (fix soon)

| 항목                                 | 위치                                                     | 왜                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| cron 중복 판정 창 20h 가 임의값      | `app/api/cron/coupang-product-sync/route.ts`             | 스펙 §6.2 가 **수동 트리거**를 요구하는데, 20h 안에 수동 재실행하면 조용히 스킵된다. 수동 트리거를 붙일 때 같이 볼 것 |
| 10원 반올림 half-up 경계 테스트 없음 | `src/lib/sh/coupang-price/__tests__/price-round.test.ts` | 돈 반올림이다. 5로 끝나는 값의 동작이 테스트로 고정돼 있지 않다. 3줄                                                  |
| report 라우트가 `body.status` 미검증 | `app/api/coupang/write-jobs/[jobId]/report/route.ts`     | Prisma enum 이 500 으로 막아 데이터 오염은 없으나, 500 은 워커에서 "보고 실패"로 보여 잡이 RUNNING 에 갇힌다          |

## 남겨둠 (leave)

| 항목                                                 | 왜 안 고치나                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| cron 중복 생성 TOCTOU                                | 피해 = `PRODUCT_SYNC` 잡 1건 중복(70초, upsert 라 멱등). 막으려면 마이그레이션 + 날짜버킷 컬럼이 필요한데 값어치가 안 맞는다 |
| `signatureOf` 델리미터 충돌                          | cuid 가 고정 길이라 실질 불가능. 그 파일 손댈 때 주석 한 줄만                                                                |
| 구성 pair 순서 무관 테스트 없음                      | `signatureOf` 의 `.sort()` 가 코드로 보장                                                                                    |
| registry 인라인 `as unknown as` 캐스트               | 스타일 불일치일 뿐                                                                                                           |
| link 충돌 에러가 해제 방법 미안내                    | 해제 플로우 자체가 v1 범위 밖 — 안내할 곳이 없다                                                                             |
| Wing 링크가 보드 카드가 아니라 apply 다이얼로그 행에 | 보드 카드는 채널 단위라 `vendorItemId` 가 하나로 특정되지 않는다. 의도 충족                                                  |
| `finance-actions.e2e.test.ts` jest 병렬 unique 충돌  | 이 기능과 무관한 기존 flake. 별건                                                                                            |

## 구조적 한계 (기록용, 고칠 대상 아님)

- **PUT 도달 후 응답 유실** — 쿠팡이 처리했는데 응답이 끊기면 해당 타깃이 `ok:false` 로 기록된다. 실제로는 가격이 바뀌었는데 "실패"로 보고된다. stale 회수가 같은 값을 다시 밀어 수렴하므로 틀린 가격이 남지는 않는다.
- **C2 검증은 생성 시점 1회뿐** — 워커는 `payload.targets[].vendorItemId` 로 실행하므로, 6시간 승인 창 안에 리스팅↔쿠팡옵션 매핑이 바뀌어도 재검증되지 않는다.
- **`report` 라우트의 키 비교가 평문 `===`** — `resolveCollectionAuth` 경로로 바꾸면서 `timingSafeEqualString` 에서 벗어났다. 전체 길이 API 키에 대한 원격 타이밍 공격은 실효성이 없다고 판단.
- **워크스페이스 재해석으로 인한 stale** — `report` 가 보고 시점에 workspaceId 를 다시 해석하므로, 잡 실행 중 `InvStorageLocation` 연결이 바뀌면 `count=0` → `{stale:true}` → 잡이 RUNNING 에 갇히고 Slack 흔적이 없다. 체인이 결정적이라 실위험은 거의 0.

## 미구현 (스펙이 요구했으나 재료가 없음)

| 스펙                                | 상태                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §16.4 IP 거부 전용 알림 경로        | **스펙을 개정했다.** 재사용 가능한 알림기가 코드베이스에 없다(기존 처리는 `orchestrator`/`verify` 안의 인라인 플래그). v1 은 루프 중단까지만. 전용 알림기는 후속   |
| §12 역할 게이트가 Slack 승인 경로에 | **운영 전제로 명시했다**(§12.1). `slackUserId ↔ User` 매핑이 스키마에 없어 고칠 재료가 없다. 승인 채널에 ADMIN 만 두는 것으로 대체. Slack 사용자 매핑은 후속       |
| §12 `idempotencyKey`                | 선언만 있고 이 액션에서 미사용. 실제 멱등은 `CoupangWriteJob.actionId @unique` 가 담당. 더블클릭 시 액션 2개·잡 2개가 생기나 가격 PUT 이 자연 멱등이라 결과는 같다 |
| 액션 생성 역할 게이트               | `app/api/agent/actions/route.ts` 는 멤버십만 확인하고 role 을 보지 않는다. 기존 승인 큐 구조이고 액션 3종 공용이라 이 브랜치 범위 밖                               |

## 이번 작업에서 드러난 레포 사실 (다음 사람용)

- **`tsconfig.json` 이 `worker` 를 exclude 한다.** 루트 `npx tsc --noEmit` 은 워커 코드를 타입체크하지 않는다. 워커를 고쳤으면 `cd worker && npx tsc --noEmit` 을 따로 돌려야 한다. 현재 그쪽에 `analysis-poller.ts` 기존 에러 4건이 있다.
- **워커 테스트는 `node:test` 기반**이라 Jest 로 돌리면 통과해도 실패로 보고된다. `npx tsx --test <file>` 을 쓴다.
- **`*.e2e.test.ts` 는 `DATABASE_URL` 이 셸에 없으면 조용히 전건 skip 된다**(`describe.skip`). "28건 skip" 을 통과로 오인하기 쉽다. `export $(grep -E '^DATABASE_URL=' .env.local | head -1 | xargs)` 후 실행할 것.
- **`prisma migrate dev` 는 이 레포에서 구조적으로 불가능하다.** shadow DB 에 Supabase 관리 `storage` 스키마가 없어 기존 마이그레이션 replay 가 실패한다. `migrate diff --from-schema <파일> --to-schema <파일> --script` + `migrate deploy` 가 정규 경로이고, **라이브 DB 기준 diff 는 절대 금지**(공유 dev DB 에 타 브랜치 객체가 올라가 있어 DROP 구문이 섞인다).
