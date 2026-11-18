# 에이전트 초안 생성 — 설정 스위치 대신 권한(scope) 「초안 바로 만들기」

## 배경

#1513(2026-11-18)으로 「초안 자동 실행」을 에이전트별 설정 스위치로 만들었다. 에디 결정(같은 날): 설정 기능이 너무 많아진다 → 스위치를 없애고 **권한으로** 연다. 실행 전 확인은 에밀리가 Slack에서 사용자에게 묻는다.

1차 계획(write scope 만으로 자동 실행) Codex 적대 검토 blocking 3건:

1. [critical] 기존 「쓰기(제안)」 권한을 동의 없이 자동 실행 권한으로 소급 확대 → **별도 scope `draft:create` 로 opt-in**.
2. [high] 게이트가 회수된 scope 를 재검사하지 않음 → **잠근 에이전트 행에서 현재 scopes 재확인**.
3. [high] 자기 신고 요청자·OWNER 를 승인자로 기록 → **`draft:create` 를 부여한 관리자**를 기록(권한 저장 시점에 서버가 기록, 에이전트가 조작 불가) + 「<에이전트 이름> 자동 생성」 표시. 에디 선택.

## 설계

### 권한

- `src/lib/agent/identity/principal.ts` `SCOPES` 에 `'draft:create'` 추가. 의미: 대상 초안 생성 액션을 승인 없이 바로 실행. 대상 액션의 쓰기 scope(`sellerhub:write`/`hiring:write`)도 함께 있어야 한다(도구 호출 자체가 그 scope 를 요구).
- 연동 계정(integration)에는 부여 불가(400) — 자동 실행은 에이전트+토큰 경로만.
- 카드 권한 선택에 그룹 「초안 바로 만들기(승인 없이)」 추가, agentOnly. 설명: 「발주 계획·모집 공고 초안을 승인 없이 바로 만듭니다. 이 권한을 준 관리자 이름으로 기록됩니다」.

### 부여자 기록 (기존 컬럼 재사용, 마이그레이션 없음)

- `SpaceAgent.autoExecuteEnabledById/At` = `draft:create` 를 부여한 관리자·시각. PATCH 에서 scopes 에 `draft:create` 가 **새로 들어오면** `auth.userId`·now 기록, 빠지면 null. 이미 있던 걸 유지하는 저장은 바꾸지 않는다. scope 변경은 기존대로 MFA(aal2) 필요.
- `autoExecuteDrafts` 컬럼은 미사용(운영 적용됨, DROP 금지) — 스키마 주석 표기. PATCH 의 `autoExecuteDrafts` 입력·카드 스위치 UI 제거.

### 게이트 (`execute.ts` autoGate)

잠근 에이전트 행에서: `status='ACTIVE'` && `scopes` 에 `draft:create` 와 `requiredScope`(액션별) 포함 && `autoExecuteEnabledById = deciderId`. 잠근 토큰 행: 미폐기·미만료. `autoGate` 인자에 `requiredScope` 추가. scope 회수·폐기·비활성화와 행 잠금으로 직렬화.

### 생성 흐름 (`create.ts` tryAutoExecute)

대상 = `def.autoExecutable` && actor=agent && actorTokenId. 에이전트 행(spaceId 일치)에서 `scopes` 에 `draft:create` 와 액션 requiredScope 가 있고 `autoExecuteEnabledById` 가 있으면 decider = 그 관리자로 `approveAndExecute(..., { autoGate })`. 역할 검사(ADMIN 이상)는 기존대로 — 부여자가 강등되면 승인 대기. 결과 매핑은 #1513 그대로.

액션 정의에 `autoScope: 'sellerhub:write' | 'hiring:write'` 를 둔다(reorder=sellerhub:write, create_draft=hiring:write).

### 자동 생성 표시

- 발주 계획: `memo` 앞에 `[<에이전트 이름> 자동 생성] ` — seller-hub 액션 execute 에서 ctx.actor 가 agent 이고 자동 실행일 때. 실행 컨텍스트에 `autoExecuted: true` 와 `actorName` 을 넘긴다.
- 모집 공고 초안: 공고 모델에 메모 필드가 있으면 같은 표시, 없으면 생략(승인 큐 기록에 actor=agent·decidedBy 로 남음).
- 승인 내역 화면: actor=agent 이고 decidedBy 가 있으면 「<이름> 자동 생성 · 권한 부여: <관리자>」 문구(기존 목록 셀 문구 분기, 화면 구조 변경 없음).

### 도구·에밀리

- 도구 설명: 「`draft:create` 권한이 있으면 바로 만들고 링크를 돌려준다. **만들기 전에 사용자에게 수량·대상을 보여 주고 확인받아라**」.
- 에밀리 지시문 §4: 「발주 올려 <상품>」 → `sellerhub_get_reorder_preview` 로 수량·위치 분배를 보여 주며 「이대로 발주 계획 초안을 만들까요?」 → 동의하면 `sellerhub_create_reorder_plan` → executed 면 링크.

## 변경 파일

- `principal.ts`(scope), `agent-tokens-card.tsx`(스위치 제거·권한 그룹), `agents/[agentId]/route.ts`(PATCH: autoExecuteDrafts 제거, draft:create 부여자 기록, integration 400), `agents/route.ts`(GET 필드 — 부여자 이름 유지, POST 생성 시 draft:create 포함이면 부여자 기록·integration 거부)
- `actions/types.ts`(autoScope, 실행 ctx autoExecuted·actorName), `create.ts`, `execute.ts`, `seller-hub.ts`(memo 표시), `recruiting.ts`(autoScope)
- 승인 내역 표시(파일 확인 후), `write-tools.ts`·`recruiting-tools.ts` 설명, `prisma/schema.prisma` 주석
- 테스트

## 검증

- jest: draft:create 없음→pending(기존 에이전트 동작 불변), 있음+부여자 ADMIN→executed·memo 표시, 부여자 강등→pending, 게이트에서 scope 회수·write scope 회수·토큰 폐기·비활성→pending, integration 부여 400, PATCH 부여/유지/회수 시 부여자 기록·유지·초기화, POST 생성 시 부여자 기록, 카드에 스위치 없음·권한 그룹 표시.
- tsc·eslint, 운영: 에밀리 권한에 「초안 바로 만들기」 체크 → 「발주 올려」 → 확인 질문 → 동의 → 링크 → 계획 상세 memo 표시 확인.

## 위험과 롤백

- 사용자 확인은 지시문 수준 — 확인 없이 호출해도 초안만 생김(외부 반영 없음, 삭제로 정리).
- 롤백: 에이전트 권한에서 「초안 바로 만들기」 해제(즉시, 게이트 재확인).

## 2차 검토 반영 (blocking 2건)

1. **부여자 기록 경합:** PATCH(와 POST)에서 `prisma.$transaction` 안에 `SELECT … FROM "SpaceAgentIdentity" WHERE id=$1 FOR UPDATE` 로 행을 잠근 뒤, 현재 scopes 와 새 scopes 를 비교해 scopes·`autoExecuteEnabledById`·`autoExecuteEnabledAt` 를 한 번에 갱신한다. 새로 들어옴 → 부여자=auth.userId, 빠짐 → null, 유지 → 그대로. 테스트: 회수와 오래된 목록 저장 경합(트랜잭션 안에서 읽은 현재값 기준 판단).
2. **자동 실행 이력 판별:** `AgentPendingAction.autoExecuted Boolean @default(false)` 컬럼 추가(마이그레이션, 컬럼 추가만). autoGate 게이트 전이(`updateMany` data)에서만 `autoExecuted: true` 를 쓴다. 승인 내역·계획 memo 표시는 이 값으로만 분기한다. 수동 승인(웹·Slack)과 기존 이력은 false → 실제 승인자 표시 그대로. 테스트: 자동/수동 양쪽 표시.
