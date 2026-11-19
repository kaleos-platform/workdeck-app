# 에이전트 권한 단순화 — 업무별 읽기/쓰기, 내부 쓰기 = 바로 실행 + 실행 알림

## 배경

지금 에이전트 권한(`src/lib/agent/identity/principal.ts` `SCOPES`)은 업무별 `:read`/`:write` 에 `slack:write`, `browser:*`, `secret:*`, `draft:create`(#1515) 가 섞여 있고, `:write` 는 "제안 가능"이라 모든 쓰기가 승인 대기(`AgentPendingAction`)를 거친다.

에디 결정(2026-11-18~20 grill): deck 단위 읽기·쓰기만 관리, 쓰기 권한이면 작업이 가능해야 한다. 1차안(쓰기 = 전부 바로 실행, 지출 한도만 승인)을 Codex 3회 검토 + 우려 검토한 뒤 **권장안 채택(11-20)**:

1. **워크덱 안에서 끝나고 고칠 수 있는 쓰기 = 바로 실행.**
2. **밖으로 나가는 쓰기(외부 서비스 반영·발행·외부 API·광고) = 지금처럼 승인.**
3. **바로 실행한 작업은 Slack 에 실행 알림**(사후 확인) — 승인 알림을 대신한다.

## 확정된 결정

1. 권한 목록 = 업무별 읽기/쓰기 + 비밀값 읽기/쓰기.
   - `draft:create` 폐지(초안도 업무 쓰기 권한으로).
   - `slack:write` 폐지 → 업무 쓰기 권한이 하나라도 있는 **에이전트·연동 계정**에 slack_post 허용. system 주체(내장 에이전트 `systemToolContext`)·미인증 요청자는 서버에서 계속 거부.
   - `browser:read`/`browser:write` → 브랜드 운영(`sellerhub:read`/`sellerhub:write`)으로 흡수. 기존 browser 권한은 **회수**(변환 안 함), 필요하면 관리자가 재부여. 배포 전 해당 에이전트 목록을 에디에게 알린다.
   - `secret:read`/`secret:write`/`secret:env` 유지.
2. 읽기 권한만으로는 아무것도 쓰지 못한다(초안 포함).
3. 기록 담당자 = 그 업무 쓰기 권한을 준 관리자(서버 기록). 연동 계정은 로그인한 구성원.
4. 기존 쓰기 권한은 관리자가 권한 편집에서 다시 저장해야 바로 실행으로 바뀐다(그 전엔 승인 대기).

## 액션 분류 (액션 정의에 `external: true` 로 표시)

| 액션                                                                             | 분류             | 이유                                                                                                                                                |
| -------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seller-hub.reorder.plan.create`                                                 | 내부 → 바로 실행 | DRAFT 계획                                                                                                                                          |
| `seller-hub.keywords.update`                                                     | 내부 → 바로 실행 | 워크덱 키워드 저장(쿠팡 반영은 별도) — **구현 시 `applyKeywordsToTarget` 이 외부 호출을 하지 않는지 확인**, 하면 external                           |
| `recruiting.posting.create_draft`                                                | 내부 → 바로 실행 | 공고 초안                                                                                                                                           |
| `recruiting.posting.update_draft`                                                | 내부 → 바로 실행 | 초안 수정 — 덮어쓰기라 `beforeState` 스냅샷을 실행 알림에 「이전 내용 보기」로 남긴다                                                               |
| `finance.transaction.reclassify` (`learn: false`)                                | 내부 → 바로 실행 | 거래 1건 분류만                                                                                                                                     |
| `finance.transaction.reclassify` (`learn` 기본/true), `finance.classrule.create` | **승인**         | 분류 규칙을 만들거나 덮어써 이후 자동 분류에 영향, 이전 규칙 복구 근거 없음(4차 리뷰 반영). 액션 정의에 `external: (params) => boolean` 함수형 허용 |
| `sales-content.setup.apply`                                                      | 내부 → 바로 실행 | 워크덱 설정 — **구현 시 외부 호출 여부 확인**                                                                                                       |
| `coupang-ads.analysis.trigger`                                                   | 내부 → 바로 실행 | 분석 작업 실행                                                                                                                                      |
| `coupang-ads.execution.approve`                                                  | **외부 → 승인**  | 쿠팡 광고 입찰·키워드 반영                                                                                                                          |
| `meta-ads.*`                                                                     | **외부 → 승인**  | 광고 변경·지출                                                                                                                                      |
| `google-marketing.*`                                                             | **외부 → 승인**  | GA4·GTM 변경                                                                                                                                        |
| `sales-content.post.publish`                                                     | **외부 → 승인**  | 블로그 발행                                                                                                                                         |
| `secret.http.request`                                                            | **외부 → 승인**  | 외부 API 호출                                                                                                                                       |
| browser(카페24 개발 설정)                                                        | **외부 → 승인**  | 외부 사이트 조작(기존 웹 확인 유지)                                                                                                                 |

외부 액션은 지출 한도·OWNER 승인 등 기존 정책 그대로라 #1차안의 지출 판정 로직(금액 null 처리 등)은 **필요 없다**(전부 승인).

## 설계

### 권한·부여자 저장

- `SCOPES`: `draft:create`·`slack:write`·`browser:read`·`browser:write` 제거.
- 저장된 scopes 정규화: 위 4개 **제거만**(변환 없음). 읽을 때(관대 파싱)와 저장 때.
- 마이그레이션: `SpaceAgent.scopesBackup String[]` 에 원본 복사 → 정규화 UPDATE. `writeGrants Json @default("{}")`, `scopesVersion Int @default(0)` 추가(권한 저장마다 +1). 이전 초안 자동 실행 기록 `autoExecuteEnabledById/At` 은 NULL 로 비운다(롤백 때 구 게이트 재활성 방지). `ROLLBACK.sql` 은 **`scopesVersion = 0`(배포 후 한 번도 저장 안 됨)인 행만** 백업으로 되돌리고, 나머지는 목록만 출력해 수동 판단. draft:create·browser 복원은 그 목록 검토 후 명시적으로(4차 리뷰 반영).
- 부여자 기록: PATCH/POST 에서 행 잠금 트랜잭션(`SELECT … FOR UPDATE`) 안에서 계산 — 저장 후 남는 `:write` 중 grant 없는 것 → 저장한 관리자, grant 있는 것 → 유지, 빠진 것 → 삭제. 같은 목록 재저장도 허용(재저장 = 명시적 동의, MFA). 화면 문구 「저장하면 체크된 쓰기 권한이 바로 실행으로 동작하고 저장한 분 이름으로 기록됩니다」. `autoExecuteEnabledById/At`·`autoExecuteDrafts` 는 미사용 주석(DROP 금지).

### 실행 경로 (`create.ts` / `execute.ts`)

#1513·#1515 의 `tryAutoExecute`·`autoGate` 를 일반화:

- 대상: `!def.external` && 액션 정의의 `scope`(그 업무 쓰기 scope, #1515 `autoScope` 를 전 액션으로 확장).
- 에이전트(actor=agent, 토큰 있음): 잠근 에이전트 행에서 ACTIVE·scopes 에 액션 scope·`writeGrants[scope].userId` = decider. 토큰 행 잠금으로 폐기·만료 재확인.
- 연동 계정(actor=integration): decider = 인증된 `requesterUserId`(principal 에서 온 값만 — 에이전트가 넘긴 `requesterSlackUserId` 해석값이 아님을 코드로 구분). 게이트는 연동 계정 행 ACTIVE·scope 재확인.
- decider 역할 검사(requiredRole)·구독 쓰기 가드·`needsWebReview` 유지 → 역할 부족·웹 확인 필요는 승인 대기.
- **결정자 강등 경합(4차 리뷰 반영):** autoGate 트랜잭션 안에서 `SpaceMember`(spaceId, userId=decider) 행도 `FOR UPDATE` 로 잠그고 소속·requiredRole 이상을 다시 확인한다(트랜잭션 밖 `deciderDenial` 결과에 의존하지 않음). 강등·제거 경합 테스트.
- **알림 대상 필수(4차 리뷰 반영):** 자동 실행은 Space 에 유효한 Slack 실행 알림 대상(승인 알림 채널 + 설치)이 있을 때만. 없으면 승인 대기(기존 승인 화면으로 확인). deck 별 알림 토글과 무관하게 실행 알림은 보낸다.
- 결과 매핑은 #1513 그대로. `autoExecuted: true` 기록(#1515 컬럼).

### 실행 알림 (신규)

- 바로 실행(EXECUTED, autoExecuted) 되면 `notifyAutoExecuted(actionId)` — 승인 알림(`notifyPendingAction`)과 같은 Slack 대상(Space 승인 알림 채널)에 「🤖 <에이전트> 실행: <summary> → <결과 링크> · 권한 부여: <관리자>」 + 승인 내역 링크. `update_draft` 는 「이전 내용 보기」(승인 내역 상세의 beforeState) 링크.
- 실패(FAILED)도 알림. 알림 전송 실패는 실행에 영향 없지만 `AgentPendingAction.notifyError`(신규 nullable 컬럼)에 남기고 승인 내역 화면에 「실행 알림 실패」 표시(4차 리뷰 반영).
- deck 별 Slack 알림 토글은 적용하지 않는다(실행 알림 = 승인 대체 수단).

### 화면

- `agent-tokens-card.tsx` 권한 선택: 업무별 「읽기」「쓰기」 + 「비밀값」. 「쓰기(제안)」 → 「쓰기(워크덱 안 작업은 바로 실행, 외부 반영은 승인)」. 「초안 바로 만들기」 제거. 쓰기 옆 「OOO님이 부여」, 부여자 없는 기존 쓰기에 「다시 저장하면 바로 실행으로 바뀝니다」.
- 승인 내역 actorLabel(#1515) 그대로.

### 도구 설명·에밀리

- 내부 쓰기 도구: 「쓰기 권한이 있으면 바로 실행되고 결과 링크를 돌려줍니다. 실행 전에 사용자에게 대상·내용을 확인받으세요」.
- 외부 쓰기 도구: 기존 「승인 대기」 문구 유지.
- 에밀리 §4 확인 질문(반영됨) 유지.

## 변경 파일(예상)

- `prisma/schema.prisma` + 마이그레이션(writeGrants·scopesBackup·정규화) + `ROLLBACK.sql`
- `principal.ts`, `run-tool.ts`(slack 규칙), `slack-tools.ts`, `browser-tools.ts`
- `actions/types.ts`(`scope`·`external`), `create.ts`, `execute.ts`, 모든 액션 정의(scope·external), `src/lib/slack/notify-*.ts`(실행 알림)
- `agents/route.ts`·`[agentId]/route.ts`(writeGrants), `agent-tokens-card.tsx`, 쓰기 도구 설명
- 테스트

## 검증

- jest: 내부 액션(대표: 발주·재무 재분류·공고 수정) 쓰기+부여자 → 바로 실행 + 실행 알림, 외부 액션(쿠팡 광고·메타·발행·secret.http·browser) → 쓰기 있어도 승인 대기, 부여자 없는 기존 쓰기 → 승인 대기, 읽기만 → 쓰기 도구 거부, 부여자 강등·scope 회수·토큰 폐기 경합 → 승인 대기, 연동 계정 → 인증 구성원 decider·역할 부족 시 대기, slack_post(쓰기 있는 agent 허용·system 거부·쓰기 없는 agent 거부), browser 도구 sellerhub scope·기존 browser 권한 회수, writeGrants 부여/재저장/회수 경합, 실행 알림 내용·실패 알림, 카드 표시.
- 외부 호출 확인: `keywords.update`·`sales-content.setup.apply` 실행 경로에 외부 fetch·write job 없음을 코드로 확인해 표에 근거 기록.
- tsc·eslint, 운영: 에밀리 권한 재저장 → 「발주 올려」 확인 → 실행 → 링크 + Slack 실행 알림.

## 위험과 롤백

- 남는 위험: 내부 쓰기는 Slack 지시만으로 실행된다(외부 반영은 막힘). 실행 알림으로 사후 확인. 재무 재분류·키워드 저장·공고 수정은 워크덱에서 고칠 수 있다.
- 롤백: 쓰기 권한 해제(즉시 게이트 재확인). 코드 롤백 + `ROLLBACK.sql`.

## Codex 리뷰 이력

- 1차안(쓰기=전부 실행) 3회 검토 지적 12건 — 반영 11, 보류 1. 권장안 전환으로 지출 판정·광고 재개 관련 지적은 외부=승인으로 흡수.
- 권장안 4차 검토 지적 4건 — 반영 4: 게이트 안 SpaceMember 잠금·역할 재확인, 알림 대상 없으면 자동 실행 안 함·notifyError 기록·토글 무관, 롤백은 scopesVersion=0 행만·구 자동실행 기록 비움, 재무 규칙 학습·규칙 생성은 승인.
