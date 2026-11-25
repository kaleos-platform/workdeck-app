# Sentry 오류 AI 판단 · 승인 후 PR

작성 2026-11-25. 상위: `2026-11-21-sentry-autofix-loop.md`, `2026-11-24-sentry-autofix-selection-quality.md`. 와이어프레임: `docs/design/plans/sentry-ai-triage/`.

## 목표

1. 매일 미해결 오류 전체에 AI 가 우선순위(P1~P3)·유형·근거 한 줄·처리 제안(자동 수정/확인 필요/제외)을 매긴다.
2. 고칠 수 있는 P1·P2 는 수정안까지 자동, **PR 은 에디 승인 후**(어드민 버튼 또는 Slack 버튼). 승인 후 10분 안에 PR 생성. 머지·운영 릴리스는 지금처럼 사람.
3. 어드민 오류 화면에서 판단·처리 단계·수정안 요약을 보고 바로 승인한다.

## 에디 결정 (2026-11-25)

수정안 자동 + PR 승인 후 / 승인 경로 어드민 + Slack 버튼 / PR 생성 10분 주기 / 판단 대상 후보 전체 / 화면은 와이어프레임대로.

## 현재 구조 (사실)

- 러너 `scripts/sentry-autofix/run.mjs`(맥미니 launchd 04:30, dry): Sentry 를 **읽기만**(issues·events·comments GET). 결과는 맥미니 `pending/`·`runs/<runId>/selection.json`, Slack 은 `slack-post --account karls`(Hermes 봇, 버튼 처리 불가).
- 어드민 `app/admin/errors/page.tsx` + `src/components/admin/errors-table.tsx`, 메모 쓰기 `app/api/admin/errors/[issueId]/route.ts`(`requireOperator` MFA aal2, `autofix:request|skip`, 감사 로그), Sentry API `src/lib/sentry/api.ts`(`SENTRY_API_TOKEN`).
- 상태 파서 `src/lib/sentry/autofix-status.ts` = 최신 `autofix:<kind>` 메모 하나. 러너 `lib.mjs` 에 같은 KNOWN 정규식.
- Slack 버튼 승인 패턴 있음: `src/lib/slack/notify-pending-action.ts`(버튼 블록) + `app/api/slack/interactive/route.ts`(서명 검증 `SLACK_SIGNING_SECRET`, team·channel·연결 멤버 확인, action_id 분기). 봇 토큰은 Space 별 `SlackInstallation`(암호화).

## 설계

### 메모 형식 (Sentry 이슈 comment, 러너·앱 공용)

| 메모                                                                           | 쓰는 곳 | 의미                                                                       |
| ------------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------- |
| `autofix:triage p=P1 cat=data-loss act=fix` + 2줄째 근거(≤120자)               | 러너    | 판단. **상태와 별개 차원** — 파서가 최신 triage 를 따로 읽는다             |
| `autofix:ready files=2 lines=35 verify=ok review=approve` + 2줄째 요약(≤120자) | 러너    | 수정안 있음, 승인 대기. pending id 는 메모에 안 씀(러너가 shortId 로 찾음) |
| `autofix:approve by=<admin\|slack>`                                            | 앱      | 승인. 러너 poller 가 PR 생성                                               |
| `autofix:pr <url>` / `autofix:failed <code>`                                   | 러너    | 기존                                                                       |
| `autofix:request` / `autofix:skip`                                             | 앱      | 기존                                                                       |

- `cat` ∈ {user-block, data-loss, integration, degraded, noise}, `act` ∈ {fix, confirm, ignore}, `p` ∈ {P1,P2,P3}. 고정 코드 외 값이면 파서가 버린다.
- 근거·요약 문장: AI 출력이라 신뢰 불가 → 러너가 `checkText`(토큰·원문 조각·인코딩) + 길이 120 + 개행 제거 통과 시에만 쓴다. 실패하면 근거 없이 코드만.
- 메모 누적 억제: triage 는 직전 triage 와 p·cat·act 가 같고 7일 안이면 쓰지 않는다.
- **선행 확인**: 러너 토큰(`~/.config/workdeck/sentry-autofix.env` `SENTRY_API_TOKEN`)이 `event:write`(comment POST) 가능한지. 안 되면 러너 전용 토큰 발급(에디 몫) — 구현 첫 단계에서 확인, 테스트 메모는 바로 삭제.

### 러너 (`scripts/sentry-autofix/`)

1. **triage 단계**(후보 선정 직후, 수정 전): 후보 전체(최근 14일 미해결, 현재 ~15건)를 한 번의 Codex 호출로 판단. 기존 격리 방식 그대로(내부망·인증 프록시·토큰 없는 컨테이너, 저장소 없음). 입력 = 이슈별 `extractFacts` 결과(scrub 된 type·message·route·service) + count·userCount·firstSeen·lastSeen + 선정 사유 코드(정보 부족·locator 등). 출력 = JSON 배열, 스키마 엄격 검사(shortId 는 입력 집합만, 코드 값 고정, 근거 ≤120자). 파싱 실패 → 판단 없음으로 계속(수정 단계는 기존 순서).
2. **수정 대상**: `act=fix` 이고 P1·P2 인 것만, 우선순위 → 사용자 → 발생 순, 기존 `MAX_ISSUES_PER_RUN`(3). P3·ignore 는 수정 안 함(비용 절감). 사람이 `autofix:request` 한 이슈는 판단과 무관하게 포함(기존 유지).
3. **메모 쓰기**(dry 해제 일부): triage·ready·failed 메모만 Sentry 에 쓴다. 코드 push·PR 은 여전히 승인 후. `--no-write` 플래그로 끌 수 있게(롤백 스위치).
4. **digest 알림**: run 끝에 앱 `POST /api/sentry/autofix/digest`(Bearer `AUTOFIX_DIGEST_SECRET`, 본문 없음) 호출 → 앱이 Sentry 메모를 읽어 Slack 버튼 메시지를 보낸다(러너는 내용 전달 안 함 → 주입 경로 축소). 기존 `slack-post` 요약은 사유별 건수용으로 유지.
5. **publish poller**(새 launchd `ai.workdeck.sentry-autofix-publish`, 10분): 최신 상태가 `approve` 인 이슈 → pending 에서 `ready` 패치 찾기 → 새 클론(base commit 기준) `git apply --check` → 브랜치 `autofix/<shortId>-<runId>` push → `gh pr create --base develop`(제목: 예외 타입 없으면 라벨·shortId 로, `?` 금지) → `autofix:pr <url>`. 충돌·패치 없음 → `autofix:failed publish-<code>`. run lock 공유(04:30 실행과 겹치지 않게). Codex 실행 없음. push 인증 = 호스트 `gh`(kaleos-dev). PR 본문은 기존 `pr-body.md`(이미 검사 통과본).

### 앱

1. `autofix-status.ts`: `parseAutofixState` 에 `ready`·`approve` kind 추가, `parseTriage(comments)` 새 함수(최신 triage, 코드 검증). 러너 `lib.mjs` KNOWN 도 같이.
2. 처리 단계 파생(`deriveStage(state, triage)`): approve→승인됨, ready→승인 대기, pr→PR, skip→제외, failed→실패, none+act=confirm→확인 필요, none+act=ignore→제외 제안, none+triage 없음→판단 전. (정보 부족은 triage 메모의 근거로 표시, 별도 상태 없음)
3. 어드민 화면(와이어프레임 ②~⑤): 요약 칩, 우선순위 컬럼(기본 정렬 우선순위→사용자→발생, 기존 클릭 정렬 유지), 제목 아래 근거, "처리 단계" 컬럼, 단계별 버튼, 행 클릭 = 상세 Sheet(판단·수정안 요약·Sentry 링크·[PR 올리기]/[보류]/[제외]). 행 클릭이 지금은 Sentry 새 탭 → Sheet 로 바뀜.
4. 승인 API: `POST /api/admin/errors/[issueId]` action 에 `approve` 추가 — 조건: 최신 상태가 `ready` 일 때만(아니면 409). 감사 로그 기존 방식.
5. Slack: `POST /api/sentry/autofix/digest`(시크릿 상수 시간 비교) → Kaleos 플랫폼 Slack 설치(어느 SlackInstallation·채널을 쓸지 env `AUTOFIX_SLACK_SPACE_ID`·`AUTOFIX_SLACK_CHANNEL_ID`) 로 승인 대기·확인 필요 목록 + `sentry_autofix_approve` 버튼(value=issueId). `interactive/route.ts` 에 action 분기 추가: 서명·team·channel 검증 → Slack 멤버 → workdeck user 연결 확인 → **platformRole=OPERATOR** 만 → 최신 상태 `ready` 확인 → `autofix:approve by=slack` + 감사 로그.
   - Slack 승인은 MFA 를 거치지 않는다. 승인 효과는 "develop 대상 PR 생성"뿐이고 머지는 사람이 하므로 허용(에디 결정). 운영 반영 경로 아님을 PR 템플릿에 명시.

## 하지 않는 것

- PR 자동 머지, main 릴리스 자동화, worker/ 등 금지 경로 수정(기존 검사 유지).
- 어드민에 패치 원문 표시(맥미니에만 있음, 코드 검토는 PR 에서).
- triage 결과의 DB 저장(메모로 충분, 표시는 최근 14일 범위).

## 단계

1. 선행: 러너 토큰 comment 쓰기 가능 확인(쓰고 즉시 삭제). 불가면 에디에게 토큰 요청 후 대기.
2. 앱 A: 파서·단계 파생·승인 API·어드민 화면(TDD, jest). develop PR → preview 는 어드민 확인 불가라 운영 반영 후 에디 확인.
3. 앱 B: digest 엔드포인트 + Slack 버튼 분기(TDD: 서명·비운영자·상태 아님·중복 승인). env 3개 Vercel 등록(에디 확인 후).
4. 러너 C: triage 단계 + 메모 쓰기 + digest 호출(TDD, 대역 통합 테스트 + `AUTOFIX_DOCKER_TEST=1`).
5. 러너 D: publish poller + launchd(TDD: 승인 없음·패치 없음·충돌·중복 PR 방지). 처음 1회는 수동 실행으로 PR 1건 확인.
6. 순서: A → B → C → D. 각 단계 opus 리뷰(보안 포함) 후 다음.

## 검증

- 단위: 파서(잘못된 코드 값 무시), 단계 파생 표, 승인 409 조건, Slack 분기 권한, triage JSON 스키마(입력 밖 shortId·긴 근거·주입 문구 거부), 메모 억제 규칙, poller 분기.
- 통합: 대역 러너 실행에서 메모 쓰기 호출 내용 확인(원문 조각 없음), digest 호출 1회.
- 운영: 다음 04:30 후 어드민에 판단·단계 표시, Slack 버튼 → 10분 안 PR 1건.

## 위험 · 롤백

- Sentry 메모 오염: 러너 `--no-write` 로 즉시 끔. 이미 쓴 메모는 파서가 무시해도 무해.
- 잘못된 승인(Slack): 효과는 develop PR 생성뿐, PR 닫으면 끝.
- 프롬프트 주입으로 우선순위 조작: 판단은 표시·순서에만 영향, 수정 경로 검사(금지 경로·검증·리뷰)는 그대로.
- 롤백: 앱은 develop revert, 러너는 운영 체크아웃 이전 커밋 + publish launchd unload.

## Codex 계획 검토 반영 (2026-11-25, 지적 6건 — 반영 6)

1. [critical] 승인이 특정 패치에 묶이지 않음 → **반영**: `ready` 메모에 `id=<runId>-<shortId> sha=<patch sha256 앞 16자>`, Slack 버튼 value·`approve` 메모에도 같은 `id`·`sha`. 승인 API·Slack 분기는 "최신 ready 의 id·sha 와 일치"할 때만 기록(아니면 409/에페메럴 거부 — 오래된 버튼 차단). poller 는 push 직전 manifest 의 status=ready·issue·baseCommit·`sha256['patch.diff']` 를 approve 의 id·sha 와 재대조, 불일치면 `autofix:failed publish-mismatch`.
2. [high] push·PR·메모 사이 부분 실패 → **반영**: 결정적 브랜치 `autofix/<pendingId>`. poller 는 매번 ① `gh pr list --head autofix/<pendingId> --state all` 로 기존 PR 이 있으면 메모만 다시 씀 ② 원격 브랜치만 있으면 PR 생성부터 ③ 둘 다 없으면 push 부터. 통합 테스트: push 후 실패·PR 생성 후 실패·메모 POST 실패를 각각 주입해 다음 실행이 PR 1개·메모 1개로 수렴하는지.
3. [high] `checkText` 는 유출 검사기가 아님 → **반영**: AI 자유 문장을 저장하지 않는다. triage 출력은 고정 코드(p·cat·act)만. 화면·Slack 의 "근거 한 줄"은 앱이 코드+수치로 만든다(예: `데이터 누락 · 3일간 48회 · 사용자 3명`). ready 메모도 숫자·코드만(files·lines·verify·review), 요약 문장 없음. 수정 내용 설명은 PR 본문(기존 `scanTexts` 통과본)에서만.
4. [high] 전체 판단과 후보 선정 불일치 → **반영**: triage 수집을 수정 후보 선정과 분리. Sentry issues 를 `Link` 커서로 끝까지(상한 200건, 넘으면 Slack 경고) 읽어 skip·pending·실패 초과 이슈도 판단. 이슈별 최신 이벤트 조회 실패 시 이슈 메타(title 대신 type·culprit 코드·수치)로 판단. Codex 입력은 40건 단위로 나눠 호출, 한 묶음 실패는 그 묶음만 "판단 없음". 테스트: 25건 초과·pending/skip 포함·묶음 실패.
5. [high] push 권한·Slack 무MFA → **반영(단계화)**:
   - 사실: develop 브랜치 보호 없음(`branches/develop/protection` 404), 호스트 gh(kaleos-dev) 는 develop 직접 push 가능. PR 워크플로(db-security·ui-smoke)는 `pull_request` 트리거, 시크릿은 `GITHUB_TOKEN` 만. Vercel 은 브랜치 push 마다 Preview 배포(Preview 환경 변수 노출 가능).
   - 조치: poller 는 `autofix/` 접두 브랜치에만 push(코드에서 refspec 고정, develop·main 거부 테스트). `vercel.json` `git.deploymentEnabled` 에 `autofix/*: false`(와일드카드 지원 여부 구현 첫 단계에서 확인, 미지원이면 poller 를 수동 확인 전까지 비활성). develop 브랜치 보호(직접 push 금지)는 에디에게 권고.
   - Slack 승인: **1차는 어드민(MFA) 승인만**. Slack 버튼은 publish 가 운영에서 3건 이상 정상 동작한 뒤 env `AUTOFIX_SLACK_APPROVE=on` 으로 켠다(코드는 B 에서 만들되 기본 off, off 면 버튼 대신 어드민 링크). 에디 결정(Slack 버튼)은 유지하되 활성화 시점만 늦춤 — 에디 확인 필요.
6. [medium] digest 시크릿 재전송·남용 → **반영(대안 채택)**: 러너→앱 호출을 없앤다. Vercel cron `/api/cron/sentry-autofix-digest`(기존 `CRON_SECRET` 방식) 이 매일 07:30 KST 에 Sentry 메모를 읽어 Slack 발송. 새 시크릿·재전송 경로 없음, 하루 1회. 발송 실패는 기존 cron 실패 관측(Sentry)으로.

### 반영 후 바뀐 단계

1. 선행: 러너 토큰 comment 쓰기 확인(쓰고 즉시 삭제), Vercel `deploymentEnabled` 와일드카드 확인.
2. A 앱: 파서(id·sha 포함)·단계 파생·근거 문장 생성·승인 API(id·sha 일치)·어드민 화면.
3. B 앱: digest cron + Slack 메시지(기본 어드민 링크, 버튼 분기는 플래그 off).
4. C 러너: triage 수집 분리(페이지네이션·묶음)·고정 코드 출력·메모 쓰기(`--no-write` 스위치).
5. D 러너: publish poller(결정적 브랜치·복구·`autofix/` 만·manifest 재대조) + launchd. 첫 PR 은 수동 실행으로 확인.
6. E: Slack 버튼 활성화(운영 publish 3건 정상 후, 에디 확인).

## 에디 확정 (2026-11-25, 검토 후)

- Slack 버튼 승인: **처음부터 켠다**(운영자가 에디 1명). 플래그 단계(E) 삭제 — B 에서 버튼 분기 활성. 보호 장치는 유지: 서명·team·channel 검증, Slack 멤버→workdeck user→`platformRole=OPERATOR`, 최신 ready 의 id·sha 일치, 감사 로그. 운영자가 늘면 MFA 경로만 남기는 걸 다시 검토.
- 근거 한 줄: 코드·수치로 앱이 생성(AI 자유 문장 저장 안 함).
