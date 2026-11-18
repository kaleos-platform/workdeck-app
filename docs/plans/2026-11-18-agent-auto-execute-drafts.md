# 에이전트 내부 초안 액션 자동 실행

## 목표

에밀리 같은 에이전트가 「발주 올려」처럼 **워크덱 안에 초안만 만드는 액션**을 요청하면 승인 대기 없이 바로 실행하고, 만든 결과의 링크를 돌려준다. 외부 반영·돈·재무 수치가 바뀌는 액션은 지금처럼 승인을 거친다.

## 확정된 결정 (에디, 2026-11-18)

1. 범위 = 내부 초안 **새로 만들기**만: `seller-hub.reorder.plan.create`(발주 계획 DRAFT), `recruiting.posting.create_draft`(공고 초안). `recruiting.posting.update_draft`는 사람이 쓴 공고를 덮어쓰고(직무 전체 교체) 되돌릴 수 없어 **승인 유지**(Codex 지적 반영). 나머지(쿠팡 키워드·광고, 콘텐츠 발행, 외부 HTTP, 재무 재분류·규칙, 세일즈 콘텐츠 설정)도 승인 유지.
2. 실행 주체 = **스위치를 켠 관리자**. 설정 > 연동의 에이전트별 「초안 자동 실행」 스위치를 ADMIN 이상이 켜고, 자동 실행은 그 관리자가 승인한 것으로 기록한다(감사 decider, 발주 계획 createdById). 그 관리자가 ADMIN 미만으로 내려가거나 Space에서 빠지면 자동 실행하지 않고 승인 대기로 돌아간다.
3. 에이전트가 넘기는 `requesterSlackUserId`(요청자)는 자기 신고 값이라 권한 판단에 쓰지 않는다(기존 원칙 유지).

## 설계

### 스키마 (마이그레이션 1개, 컬럼 추가만)

`SpaceAgent`(`SpaceAgentIdentity`):

- `autoExecuteDrafts Boolean @default(false)`
- `autoExecuteEnabledById String?` — 켠 관리자 User.id
- `autoExecuteEnabledAt DateTime?`

### 액션 정의 (`src/lib/agent/actions/types.ts`)

- `autoExecutable?: boolean` — 위 3개 액션만 true.
- `resultUrl?: (result: unknown, ctx: { spaceId }) => string | null` — 실행 결과에서 확인 링크를 만든다.
  - 발주 계획: `/d/seller-ops/inventory/reorder/plans/{planId}` (+ spaceId 쿼리, 승인 링크와 같은 방식)
  - 공고 초안: 기존 결과의 `editUrl` 그대로

### 생성 흐름 (`src/lib/agent/actions/create.ts` `createPendingAction`)

INSERT(PENDING) 뒤, Slack 승인 알림 **전에**:

1. 대상 조건: `def.autoExecutable` && `draft.actor.type === 'agent'` && `draft.actorTokenId` 있음. 연동 계정(integration, 구성원 OAuth 세션)·토큰 없는 경로는 자동 실행하지 않는다(승인 유지).
2. `SpaceAgent`(id = actor.id, spaceId 일치)를 읽어 `autoExecuteDrafts && autoExecuteEnabledById` 이면 `approveAndExecute(action.id, enabledById, { autoGate })` 를 호출한다.
3. **`autoGate`(Codex 지적 반영 — 토큰 폐기·스위치 해제 경합)**: `approveAndExecute` 의 PENDING→APPROVED `updateMany` 를 `prisma.$transaction` 으로 감싸고, 같은 트랜잭션 안에서 먼저
   - `SELECT … FROM "SpaceAgentIdentity" WHERE id=$1 FOR UPDATE` 로 에이전트 행을 잠그고 `status='ACTIVE' && autoExecuteDrafts && autoExecuteEnabledById = deciderId` 재확인,
   - `SELECT … FROM "AgentToken" WHERE id=$2 AND "agentId"=$1 FOR UPDATE` 로 토큰 행도 잠그고 `revokedAt IS NULL && (expiresAt IS NULL OR > now)` 확인(폐기 updateMany 와 행 잠금으로 직렬화 — 2차 리뷰 반영),
   - 하나라도 아니면 전이하지 않고 거부(액션은 PENDING 유지).
     스위치 끄기 PATCH 는 같은 행을 갱신하므로 행 잠금으로 직렬화된다: 끄기가 먼저 커밋되면 자동 실행 안 함, 게이트가 먼저 통과했으면 그 1건은 실행된다(취소 불가 — 운영 안내에 명시). 기존 역할 검사(deciderDenial, requiredRole)·구독 쓰기 가드·만료 검사·실행 감사는 그대로 지난다.
4. 결과 — 실패·경합 뒤에는 **DB 상태를 다시 읽어 실제 상태로** 응답(Codex 지적 반영):
   - `EXECUTED` → `{ status: 'executed', actionId, resultUrl, result }`, Slack 승인 알림 없음.
   - `FAILED` → `{ status: 'failed', actionId, error }`.
   - 게이트 거부·`FORBIDDEN`·`BLOCKED`(액션이 아직 PENDING) → Slack 알림 + `pending_approval` + `autoExecuteSkipped` 사유.
   - `EXPIRED` → outcome 그대로 `expired`(DB 는 아직 PENDING 일 수 있어 다시 읽지 않는다 — 2차 리뷰 반영). 생성 직후라 실제로는 거의 없다.
   - `CONFLICT` → 다시 읽은 상태(APPROVED=`executing`, EXECUTED=`executed`, FAILED/REJECTED/EXPIRED=그 상태)로 응답, 알림 없음.
5. 멱등 경로(기존 액션 반환) `toResult` 도 실제 상태 반영: PENDING=`pending_approval`, APPROVED=`executing`, EXECUTED=`executed`+resultUrl.

### 멱등 키 (Codex 지적 반영 — 반복 요청이 옛 결과에 묶임)

`sellerhub_create_reorder_plan`·`recruiting` create_draft 도구의 멱등 키에 **KST 날짜**를 넣는다(파라미터 + Space + 날짜). 서버 발급 workId 는 호출마다 바뀌어 응답 유실 후 재시도를 막지 못하므로 쓰지 않는다(2차 리뷰 반영). 같은 날 같은 요청 재전송 = 같은 액션(중복 생성 없음), 다음 주 같은 상품 요청 = 새 계획. 알려진 한계: 같은 날 초안을 지우고 같은 요청을 다시 하면 지운 계획 결과를 돌려준다 — 이때는 memo 를 바꾸거나 발주 화면에서 만든다. 두 도구 모두 `actorTokenId: ctx.actorTokenId` 를 넘기도록 고친다(발주 도구는 지금 빠져 있음).

`PendingActionResult` 를 `status: 'pending_approval' | 'executing' | 'executed' | 'failed' | 'expired' | 'rejected'` 유니온으로 넓힌다(실제 반환하는 상태와 일치). 도구는 결과를 그대로 반환한다. 도구 설명 문구(「승인 후 생성」)는 「초안 자동 실행이 켜져 있으면 바로 만들고 링크를 돌려준다」로 고친다.

**MCP·내장 에이전트 응답 문구(2차 리뷰 반영):** `app/api/mcp/[transport]/route.ts` 와 `src/lib/agent/router.ts`(write tool 결과 포맷)가 지금은 `pending_approval` 외 전부 「실행 완료」로 안내한다. status 별로 나눈다: executed=「초안을 만들었습니다: resultUrl」, executing=「실행 중」, failed=「실행 실패: error」, expired·rejected=그 사유, pending_approval=기존 문구. 그 외(일반 read·직접 실행 도구 결과)는 기존 「실행 완료」.

### 설정 API·화면

- `PATCH /api/spaces/[spaceId]/agents/[agentId]` 에 `autoExecuteDrafts: boolean` 추가. 켜기는 MFA(aal2) 필요(권한 확대), 끄기는 불필요. 켤 때 `autoExecuteEnabledById = auth.userId`, `EnabledAt = now`; 끌 때 둘 다 null. 감사 로그 `space.agent.update` 에 포함.
- GET 목록에 세 필드 노출(켠 사람 이름 포함).
- `agent-tokens-card.tsx` 에이전트 행에 「초안 자동 실행」 스위치 + 설명 「발주 계획·공고 초안은 승인 없이 바로 만들고 링크를 남깁니다. 켠 관리자 이름으로 기록됩니다」 + 켠 사람·시각. 기존 활성 스위치와 같은 패턴(필드 추가, UX 흐름 변경 아님).

### 에밀리 지시문

`/Users/kaleos/aml/config/workspace/cron-prompts/inventory-weekly.md` §4: `sellerhub_create_reorder_plan` 결과가 `executed` 면 「발주 계획 초안을 만들었습니다 → <resultUrl|발주 계획 보기>」, `pending_approval` 이면 기존 문구.

## 변경 파일

- `prisma/schema.prisma` + `prisma/migrations/<ts>_agent_auto_execute_drafts/`
- `src/lib/agent/actions/types.ts`, `create.ts`, `seller-hub.ts`, `recruiting*.ts`(액션 정의 플래그·resultUrl)
- `src/lib/agent/tools/write-tools.ts`, `recruiting-tools.ts`(설명 문구)
- `app/api/spaces/[spaceId]/agents/[agentId]/route.ts`, `app/api/spaces/[spaceId]/agents/route.ts`(GET 필드)
- `app/api/mcp/[transport]/route.ts`, `src/lib/agent/router.ts`(status 별 응답 문구)
- `src/lib/agent/actions/execute.ts`(`autoGate` 옵션 — 게이트 트랜잭션)
- `src/components/integrations/agent-tokens-card.tsx`
- 테스트: create 자동 실행(켜짐→EXECUTED·알림 없음, 꺼짐→PENDING, 관리자 강등→PENDING, 비대상 액션·update_draft→PENDING, 토큰 없음·integration→PENDING, 폐기 토큰→PENDING, 게이트에서 스위치 꺼짐→PENDING, 실행 실패→failed, CONFLICT 후 실제 상태 응답), 멱등(같은 workId 재시도=같은 액션, 다른 workId=새 액션), PATCH(켜기 MFA·enabledBy 기록·끄기 초기화), 카드 스위치

## 검증

- jest: 위 테스트 + 기존 agent actions·tools·agents route 전체
- tsc·eslint 변경 파일
- 운영: 배포 후 에밀리 「초안 자동 실행」 켜기 → 「발주 올려 머드팬티」 → 즉시 계획 생성·링크 응답 → 계획 상세가 미리보기와 같은지 확인 → 초안 삭제

## 위험과 롤백

- 위험: 켠 관리자 이름으로 에이전트가 초안을 반복 생성 → 멱등 키(같은 파라미터 = 같은 액션)로 중복 차단, 초안이라 삭제로 정리.
- 위험: 권한 확대 — 스위치 켜기에 MFA, 대상 액션 하드코딩(설정으로 범위 확장 불가), 기본값 꺼짐.
- 롤백: 스위치 끄기 — 끈 뒤 들어오는 요청은 승인 대기. 끄는 순간 이미 게이트를 통과한 1건은 실행된다(초안 생성이라 삭제로 정리). 코드 롤백 시 컬럼은 남아도 무해(기본 false).

## Codex 리뷰 반영

1차 지적 5건 — 반영 5: 토큰 재확인(autoGate), update_draft 제외, 스위치 해제 직렬화(행 잠금), CONFLICT·EXPIRED 실제 상태 응답, 멱등 키 요청 단위화.
2차 지적 4건 — 반영 4: 토큰 행도 FOR UPDATE, 멱등 키는 workId 대신 KST 날짜, EXPIRED 는 outcome 그대로, MCP·내장 에이전트 응답 status 분기.
