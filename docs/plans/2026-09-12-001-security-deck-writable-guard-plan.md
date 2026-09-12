---
title: 'security: 구독 만료 Space 의 쓰기 차단 — assertDeckWritable 전면 적용'
type: security
status: draft
date: 2026-09-12
revision: 1
origin: 2026-09-11 구독 UX 개편 세션에서 발견. deck 레이아웃 진입 차단(#873, 릴리스 1cfa23b5)까지 완료했으나 API 계층은 미적용.
---

# security: 구독 만료 Space 의 쓰기 차단 — `assertDeckWritable` 전면 적용

## 배경

`assertDeckWritable(spaceId, deckAppId)`(`src/lib/billing/entitlement.ts:93`)는 "만료 Space 의 쓰기는 막고 조회는 통과"를 위해 정의됐지만 **호출부가 0건**이다. 정의만 있고 아무 데도 쓰이지 않는다.

2026-09-11 에 deck **레이아웃**(UI 진입)에는 `requireDeckAccess()` 가드를 넣었다(릴리스 `1cfa23b5`). 그러나 API 계층은 그대로라서, 구독이 만료된 Space 도 다음 경로로 계속 데이터를 쓸 수 있다:

1. **API 직접 호출** — `resolveDeckContext` 가 `DeckInstance.isActive` 만 보고 entitlement 는 조회하지 않는다
2. **MCP 에이전트** — 외부 토큰 인증이라 UI 가드가 애초에 무의미
3. **워커** — `WORKER_API_KEY` 만 보고 Space/Deck 컨텍스트를 아예 조회하지 않는다

### 지금 당장의 피해는 0

2026-09-12 기준 prod 상태:

| Space              | 상태                                                       |
| ------------------ | ---------------------------------------------------------- |
| 의식주의 (실사용)  | `exemptFlag=true` — 영구 면제                              |
| 워크덱 (PG 심사용) | seller-hub 구독 중, coupang-ads 는 GRACE (2026-09-25 만료) |
| 테스트             | `exemptFlag=true`                                          |

유료 고객이 0명이고 실운영 Space 는 면제라 **현재 새는 돈은 없다**. 다만 유료 고객이 해지하는 첫날부터 문제가 되고, 작업 규모상 그때 급하게 할 일이 아니다.

## 실측 범위 (2026-09-12, `app/api/**/route.ts` 전수)

```
mutation(POST/PUT/PATCH/DELETE) 보유 라우트 파일   249
├ resolveDeckContext 계열(deck 스코프)            209  ← 적용 대상
│   POST 126 / PATCH 65 / DELETE 65 / PUT 11 = 핸들러 267
│   같은 파일에 GET 공존                          108  ← 조회는 막으면 안 됨
├ resolveWorkerAuth (워커 전용)                    11  ← 별도 정책 필요
├ requireOperator (운영자)                        10  ← 대상 아님
├ resolveSpaceContext (deck 무관, billing/설정)     9  ← 대상 아님
├ resolveCollectionAuth                            2  ← 의도적 우회(주석 있음)
└ NONE                                             7  ← 개별 판단
```

deck 인자별 분포: seller-hub 89 · sales-content 37 · recruiting 27 · finance 19 · (인자 없음 = `resolveWorkspace`→coupang-ads 등) 77

### 단일 지점 차단이 불가능한 이유

`resolveDeckContext(deckKey)`는 **HTTP 메서드를 모른다** — 요청 객체를 인자로 받지 않는다. GET 핸들러와 mutation 핸들러가 같은 함수를 같은 인자로 호출하므로, 함수 내부에서 조회/변경을 구분할 신호가 없다. `resolveWorkspace()` 도 동일.

따라서 "한 파일만 고치면 끝"은 성립하지 않는다.

### 가장 심각한 구멍 — MCP 승인·실행 경로

MCP write tool 은 즉시 실행되지 않고 `AgentPendingAction` 에 큐잉된 뒤 `app/api/agent/actions/[actionId]/route.ts` 의 `PATCH` → `approveAndExecute()`(`src/lib/agent/actions/execute.ts`)가 실행한다. 이 경로는:

- Space 멤버십 + `assertRole` 만 확인
- **`resolveDeckContext` 호출이 전혀 없다** — `DeckInstance.isActive` 체크조차 없음
- 당연히 entitlement 체크도 없음

즉 UI·API 를 모두 막아도 이 경로는 남는다. **우선순위 1순위.**

## 접근

### Phase 1 — 관문 확장 (코드 1곳)

`resolveDeckContext` 에 옵션을 추가한다. 기본값은 기존 동작 유지(비파괴).

```ts
export async function resolveDeckContext(deckKey = 'coupang-ads', opts?: { write?: boolean })
```

`opts.write === true` 일 때만 `assertDeckWritable` 을 호출해 402(또는 403)를 반환한다. `resolveWorkspace()` 에도 같은 옵션을 뚫는다.

이 단계만으로는 **동작 변화가 없다**(아무도 `write: true` 를 넘기지 않음). 호출부 수정을 안전하게 나눠 진행하기 위한 토대다.

### Phase 2 — MCP 실행 경로 (파일 2~3개, 효과 가장 큼)

`approveAndExecute()` 또는 `getActionDefinition().execute()` 직전에 `assertDeckWritable` 을 넣는다. 액션 정의에 deck 이 매핑돼 있으므로 액션 레지스트리에서 deckAppId 를 얻는다. 여기가 가장 넓게 뚫려 있으면서 수정 지점은 가장 적다.

### Phase 3 — mutation 핸들러 209 파일

`resolveDeckContext(deckKey)` → `resolveDeckContext(deckKey, { write: true })`.

**deck 단위로 쪼개 PR 을 나눈다** — 한 PR 이 89개 파일을 넘지 않게:

| PR  | 대상                                 | 파일 수 |
| --- | ------------------------------------ | ------- |
| 3-a | finance                              | 19      |
| 3-b | recruiting                           | 27      |
| 3-c | sales-content                        | 37      |
| 3-d | coupang-ads(`resolveWorkspace` 포함) | ~77     |
| 3-e | seller-hub                           | 89      |

작은 deck 부터 시작해 패턴과 회귀 테스트 방식을 확정한 뒤 큰 deck 으로 간다.

**기계 변환 주의**: GET 공존 파일 108개에서 GET 핸들러의 호출까지 바뀌면 조회가 막힌다. 치환은 반드시 **핸들러 함수 블록 단위**로 판단해야 하며, 단순 문자열 치환은 금지다.

### Phase 4 — 워커 정책 결정 (코드 전 의사결정)

워커 11개 라우트는 Space/Deck 컨텍스트가 없다. 선택지:

- **A.** 그대로 둔다 — 수집은 계속하되 사용자가 볼 수 없으니 실익 없음(단, 저장 비용은 계속 발생)
- **B.** 워커 진입점에서 Space 별 entitlement 를 조회해 만료 Space 는 수집 스킵
- **C.** 수집은 하되 만료 Space 는 적재 대상에서 제외

B 가 비용 측면에서 합리적이나 워커 스케줄러 구조를 봐야 한다. **Phase 3 이후 별도 판단.**

## 검증

각 Phase 공통:

1. `npm run lint` · `npm run build` · `tsc --noEmit`
2. **회귀 테스트 필수** — `src/lib/billing/__tests__/` 에 "만료 Space 는 쓰기 402, 조회 200" 을 고정하는 통합 테스트. 기존 `subscription-service.e2e.test.ts` 패턴 재사용
3. 로컬 QA: dev DB 에서 특정 deck 을 `SUBSCRIPTION` + `paidActivatedAt` 을 60일 전으로 설정해 LOCKED 재현 → 해당 deck 의 대표 mutation 1건이 402, GET 1건이 200 인지 확인 → **dev DB 원복**
4. 면제(`exemptFlag=true`) Space 가 영향받지 않는지 반드시 확인 — 실운영 계정이 면제로 돌아가고 있다

## 롤백

Phase 1 의 옵션은 기본값이 기존 동작이므로, 문제가 생기면 해당 PR 만 되돌리면 된다. Phase 3 는 deck 단위 PR 이라 부분 롤백이 가능하다.

## 선행 조건

- 이 작업 중 **유료 전환을 하지 말 것**. 가드가 붙는 도중에 과금이 켜지면 정상 사용자가 402 를 맞을 수 있다
- 워크트리는 `workdeck-app-billing` 사용 (다른 세션과 공유 금지 — 2026-09-11 에 커밋 혼입·브랜치 탈취 사고 2회)

## 참고

- 진입 차단(완료): `src/lib/billing/deck-layout-guard.ts`, 릴리스 `1cfa23b5`
- entitlement 판정: `src/lib/billing/entitlement-core.ts` (`FREE_BETA` → `EXEMPT` → `SUBSCRIBED` → `TRIAL` → `GRACE` → `LOCKED` 순)
- `GRACE_DAYS = 14`, `TRIAL_DAYS = 14`
