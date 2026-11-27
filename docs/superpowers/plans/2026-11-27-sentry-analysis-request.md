# Sentry「확인 필요」분석 요청 → 비공개 GitHub 이슈

작성 2026-11-27. 브랜치 `feat/sentry-analysis-request`(origin/develop 기준). 와이어프레임 `docs/design/plans/sentry-analysis-request/`(에디 승인: A 판정 고정 코드 · B 10분 poller · C Slack 버튼 · 수정 요청은 상세 패널로).

## 목표

「확인 필요」 이슈를 운영자가 [분석 요청] → 러너가 코드 수정 없이 원인·영향·판정을 분석 → **비공개 저장소 `kaleos-platform/kaleos-ax-project`** 이슈(라벨 `sentry-analysis`)로 게시 → Sentry 메모에 판정 고정 코드+이슈 번호 → 어드민 배지·다음 버튼, Slack 완료 알림.

`workdeck-app` 은 PUBLIC 이라 이슈 게시 대상에서 제외(에디 결정 11-27).

## 메모 형식 (Sentry 이슈 코멘트, 고정 코드만)

기존 `autofix:analysis`(코드에서 쓰는 곳 없음, 예약어)는 건드리지 않고 **새 kind 4개**(`analyze-request·analyzing·analyzed·analyze-failed`)를 쓴다 — 롤백 시 이전 코드는 새 메모를 KNOWN 밖으로 보고 무시하므로 상태 의미가 바뀌지 않는다.

| 메모      | 쓰는 쪽          | 형식                                                                                                             |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| 분석 요청 | 앱(어드민·Slack) | `autofix:analyze-request id=<nonce> by=admin\|slack sig=<HMAC32>`                                                |
| 분석 중   | 러너             | `autofix:analyzing id=<nonce> until=<ISO>`                                                                       |
| 분석 완료 | 러너             | `autofix:analyzed id=<nonce> verdict=fix\|watch\|ignore conf=high\|mid\|low auto=yes\|no issue=<n> sig=<HMAC32>` |
| 분석 실패 | 러너             | `autofix:analyze-failed <code>`                                                                                  |

- `nonce` = `YYYYMMDD-HHMMSS-<8hex>`(UTC 발급 시각 포함). 서명은 기존 `noteSig(kind, issueId, id, sha)` 재사용: request `('analyze-request', issueId, nonce, '0'*16)`, analyzed `('analyzed', issueId, nonce, sha16("verdict|conf|auto|n"))`.
- 유효 조건(앱·러너 공통): 서명 일치. 러너는 추가로 **발급 24시간 이내** 요청만 실행, 소비한 nonce 는 state(`analyze/<issueId>-<nonce>.json`)에 기록.
- analyzed 는 `id` 가 그보다 앞선 최신 analyze-request 의 nonce 와 같을 때만 인정(과거 analyzed 재게시로 판정을 되돌릴 수 없음).
- 이슈 링크는 번호 `n` 만 저장하고 URL 은 앱이 `https://github.com/kaleos-platform/kaleos-ax-project/issues/<n>` 로 조립(임의 URL 불가).
- **남는 위험(수용)**: Sentry 쓰기 권한자가 과거 요청+완료 메모 쌍을 그대로 재게시하면 옛 판정이 다시 보인다. 새 분석 실행·새 이슈·코드 변경은 불가. Sentry 조직 구성원 목록은 토큰 권한 부족으로 **미확인**(에디 계정만이라는 전제로 수용, 다르면 재검토).
- AI 문장은 Sentry·Slack·어드민에 쓰지 않는다. 본문은 이슈에만.

## 단계 (앱)

1. `src/lib/sentry/autofix-sig.ts`: `NoteKind` 에 `'analyze-request' | 'analyzed'` 추가.
2. `src/lib/sentry/autofix-status.ts`:
   - KNOWN 에 `analyze-request|analyzing|analyzed|analyze-failed` 추가. `AutofixState` 에 `nonce·verdict·conf·auto·issueNumber`.
   - `analyzed` 파싱(enum 검사, id 가 직전 analyze-request nonce 와 일치할 때만).
   - Stage: `analyze-requested`(분석 요청됨) · `analyzing`(분석 중, until 지나면 "분석 중(만료)"+[다시 요청]) · `analyzed`(분석 완료) · `analyze-failed`(분석 실패). 기존 `analysis`("분석만") 유지.
   - `shouldWriteNote` 에 `analyze-request` 추가(이미 요청됨·분석 중이면 생략).
3. `src/lib/sentry/api.ts` `isAuthentic`: analyze-request·analyzed 서명 검증 추가(analyzing 은 서명 없음 — 표시용, 러너는 자기 state 로 판단).
4. `app/api/admin/errors/[issueId]/route.ts`: action `analyze` 추가 → nonce 생성·서명 메모, 감사 기록(`sentryIssue.analyze`). 서명 키 없으면 503.
5. `src/components/admin/errors-table.tsx` (`actionsFor`·배지·Sheet):
   - confirm: 행 [분석 요청][제외], Sheet [분석 요청][수정 요청][제외].
   - analyze-requested: [제외] / analyzing: 없음(만료 시 [다시 요청]) / 분석 실패: [다시 요청][제외].
   - analyzed: 배지 "고칠 것·지켜볼 것·무시 · 이슈 #N ↗". 버튼 fix→[수정 요청][제외], watch→[제외], ignore→[제외 확정].
   - Sheet「분석」섹션: 판정·확신도·자동 수정 가능·이슈 링크·시각.
6. Slack: `autofix-digest.ts` 확인 필요 줄마다 [분석 요청] 버튼(`sentry_autofix_analyze`, value=`issueId`, 최대 5). `slack-approve.ts` 에 `handleSentryAnalyzeRequest` — approve 와 같은 가드(OPS 설치·OPS 채널·연결 구성원·OPERATOR) + 상태가 이미 요청/분석 중이면 안내만. `app/api/slack/interactive/route.ts` 분기 추가.

## 단계 (러너, `scripts/sentry-autofix/`)

7. `lib.mjs`: KNOWN 확장(`analyze-request|analyzing|analyzed|analyze-failed`). `judgeIssue`: 최신이 넷 중 하나면 일일 수정 대상 아님(기본 분기로 이미 ineligible — 테스트로 고정). 분석 후 수정은 운영자 [수정 요청](`autofix:request`)으로만. `parseAnalyzeOutput`(verdict.json 엄격 검사), `analysisNote`, `buildAnalysisIssueBody`(양식 섹션 고정 머리말 + 분석 본문 펜스, 6000자 상한).
8. 새 `analyze.mjs` poller(launchd 10분, `ai.workdeck.sentry-autofix-analyze.plist`, publish 와 같은 run lock — 잡혀 있으면 조용히 종료+로그. **회당 1건**. 일일 러너(04:30, lock 대기 약 5분) 보호: `now+40분` 이 04:25 KST 를 넘으면(03:45~) 06:30 까지 시작 안 함. 별도 lock 금지 — 일일 `killResidue` 가 분석 컨테이너를 죽임):
   - **상태 파일** `~/.local/state/workdeck-autofix/analyze/<issueId>-<nonce>.json` `{stage: started|issue-created|done|failed, attempts, issueNumber}` — 각 외부 작업 직후 갱신(원자적 rename).
   - 선정: Sentry 미해결 이슈 수집 → 최신 분석 트랙 메모가 (a) 서명 맞고 24h 이내인 analyze-request 이거나 (b) 같은 nonce 의 analyzing(until 만료) 이고, 상태가 done·failed 아닌 것. 24h 만료는 **nonce 에 박힌 발급 시각** 기준(코멘트 dateCreated 아님 — 재게시하면 새 시각이 됨). Sentry 최신 이벤트를 조회해 `extractFacts` 입력으로.
   - 실행: `autofix:analyzing id= until=now+40m` → prepareSource(clone+archive) → startProxy → 분석 컨테이너(내부망, `/work/repo` **읽기 전용**, `/ctx` 에 `buildContext` 사실·`prompts/analyze.md`, `/out`), 25분 제한. 설치·patch·검증 없음.
   - 호스트 검사: `readSafeBuf` 64KB · `checkText(analysis)` · `parseAnalyzeOutput` · `scanTexts`(토큰 조각·Sentry 원문 조각·gitleaks) · **출력에 `scrubText` 패턴(이메일·전화·카드·JWT·Bearer·주소) 일치 시 거부**(긴 숫자 패턴은 줄 번호·시각 오탐 → 분석용 변형으로 조정). 검사는 모델 출력에만, `요청 ID` 머리말은 검사 뒤에 붙임. 프롬프트는 오류 메시지를 인용하지 말고 유형·파일:줄로 지칭(원문 조각 검사 오탐 방지). 현실적인 분석 예시 fixture 가 검사를 통과하는지 테스트로 고정. 하나라도 걸리면 이슈 안 올리고 `autofix:analyze-failed <code>`.
   - 게시: 이슈 본문 첫 줄 고정 `요청 ID: <nonce>`. 생성 전 `gh issue list --repo kaleos-platform/kaleos-ax-project --label sentry-analysis --state all --limit 200 --json number,body` 후 첫 줄 정확 일치를 로컬 비교(검색 색인 지연 회피) — 조회 오류면 이번 주기 중단(일시 오류), 정확히 일치하는 이슈가 있으면 재사용. 생성 성공 즉시 상태 `issue-created`+번호 기록. 생성 명령 실패(결과 불확실)는 다음 주기에 검색부터.
   - 완료 메모 직전 Sentry 메모 재조회: analyzing 이후 `skip`·`request`·더 새 analyze-request 가 있으면 analyzed 메모를 쓰지 않고(상태 done, Slack 만) 운영자 조작을 덮지 않는다. 아니면 `autofix:analyzed … sig=` → Slack `분석 완료 <shortId> <판정> 이슈 #n`(제목·본문 없음).
   - 일시 오류 3회까지 다음 주기 재시도, 이후 `failed`.
   - 이슈 제목 `[Sentry 분석] <shortId> <판정>`(Sentry 제목 넣지 않음). 모델 입력은 기존 `extractFacts`(scrub 된 type·message·title·route·프레임) 그대로 — 새 필드 추가 안 함.
9. `prompts/analyze.md`: 양식(무엇 파일:줄 / 원인 추정+근거+확신도 / 실제 영향 / 판정 / 고친다면 방향·범위·자동 수정 가능 여부, worker/·auth·billing 금지) 마크다운 `/out/analysis.md` + `/out/verdict.json` `{verdict, conf, auto}`. 코드 수정 금지.
10. 라벨 `sentry-analysis` 를 kaleos-ax-project 에 생성(에디 확인 후 한 번).

## 검증

- jest: autofix-status(파싱·stage·서명 없는 메모 무시·URL 검사), route(analyze·중복·503), digest 버튼, slack 핸들러 가드.
- `node --test lib.test.mjs publish.test.mjs analyze.test.mjs`: 선정(서명·24h 만료·nonce 소비·회당 상한·러너 시간대), 재게시 공격(옛 요청·옛 analyzed 재게시), 부분 실패 복구(이슈 생성 후 응답 유실·Sentry 메모 실패·analyzing 만료), 검색 오류 시 생성 안 함, 분석 중 skip/request 가 들어오면 analyzed 미기록, 검사 실패(토큰·원문 조각·PII 패턴·악성 Sentry 메시지 지시 반영 출력) 시 이슈 미게시, judgeIssue 가 새 kind 를 수정 대상에서 뺌(기존 analysis·request 이력과 섞인 경우 포함), no-write.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- 운영 실검증: 확인 필요 1건 [분석 요청] → 약 40분 안(10분 주기+분석 25분) 이슈·메모·어드민 배지·Slack 확인.
- opus 보안 리뷰(서명·URL 검사·이슈 본문 유출 경로).

## 롤백

- 앱: PR revert. 새 kind 3개는 이전 코드 KNOWN 밖이라 무시 → 이전 상태(확인 필요 등)로 보임. 일일 선정도 이전과 같음.
- 러너: `launchctl bootout` analyze plist. 일일 러너·publish 무관.
- 이슈: kaleos-ax-project 에서 닫기.

## 하지 않음

- 분석 결과로 자동 수정 실행(운영자가 [수정 요청]).
- 어드민 DB 저장(에디가 GitHub 이슈 선택).
- 기존 수정 PR 본문의 analysis.md 가 PUBLIC 저장소 PR 에 실린다 — 별건, 에디에게 바로 보고.

## 공통 계약(앱·러너 동일)

- KNOWN: `^autofix:(request|running|pr|analysis|failed|skip|ready|approve|analyze-request|analyzing|analyzed|analyze-failed)(\s|$)`
- ANALYZE_REQUEST: `^autofix:analyze-request id=(\d{8}-\d{6}-[0-9a-f]{8}) by=(admin|slack) sig=([0-9a-f]{32})$`
- ANALYZING: `^autofix:analyzing id=(\d{8}-\d{6}-[0-9a-f]{8}) until=(\S+)$`
- ANALYZED: `^autofix:analyzed id=(\d{8}-\d{6}-[0-9a-f]{8}) verdict=(fix|watch|ignore) conf=(high|mid|low) auto=(yes|no) issue=(\d{1,7}) sig=([0-9a-f]{32})$`
- ANALYZE_FAILED: `^autofix:analyze-failed ([a-z0-9-]{1,40})$`
- 서명: request `noteSig('analyze-request', issueId, nonce, '0000000000000000')`, analyzed `noteSig('analyzed', issueId, nonce, sha256(`${verdict}|${conf}|${auto}|${n}`).hex[0:16])`.
- 공통 시험 벡터: secret=`'s'.repeat(32)`, issueId=`'123'`, nonce=`'20261127-010203-0a1b2c3d'` → jest·node --test 양쪽이 같은 값을 단언.

## Codex 리뷰 반영 (2026-11-27, 지적 6건 — 반영 5, 일부 보류 1)

1. [high] analyzing 이 요청을 가려 재시도 불가 → 반영: analyzing 에 nonce, 상태 파일 단계 기록, 만료 analyzing 재선정.
2. [high] 서명 요청 재게시 → 반영: 24h 만료·nonce 소비 기록, analyzed 는 최신 요청 nonce 에 묶음. 상태 손실+재게시 쌍은 남는 위험으로 명시(Sentry 구성원 = 에디).
3. [high] 기존 analysis 의미 변경 → 반영: 새 kind `analyzed` 사용, 기존 analysis 그대로.
4. [high] 자동 스캔만으로 PII·주입 차단 불가 → 일부 반영: 출력 PII 패턴 거부·Sentry 제목 이슈 제목 제외·입력 필드 추가 안 함. **사람 승인 단계는 보류** — 대상 저장소 협업자 2명(hero4earth = Sangwon Kim, kaleos-dev = 이 저장소 커밋 계정 — 에디 계정으로 보임)뿐이고 Sentry 와 같은 접근 범위라 확산이 없으며, 분석 요청 자체가 운영자 조작. 에디 결정(11-27): 자동 게시 유지.
5. [medium] nonce 검색·생성 불확실 → 반영: 본문 첫 줄 고정 ID, 검색 오류=중단, 생성 직후 상태 기록.
6. [medium] lock 경합·상태 덮어쓰기 → 반영: 회당 1건·03:45~06:30 시작 안 함, lock 잡히면 조용히 종료, 완료 메모 직전 재조회로 skip/request 덮지 않음.

- request sig = `155d3594dcb210d2680723039428b67f`
- analyzed(verdict=fix conf=mid auto=yes n=42): sha16 = `b0c208ff7cedfa83`, sig = `d4bf32eff2a54bcd4dea39f26de7ffbc`

## 구현 후 보안 리뷰(opus, 11-27) — Blocking 0, Low 3 모두 반영

1. 선정 뒤 시작 금지 시간대 재검사(수집이 길어져 04:30 일일 실행을 막지 않게).
2. 이슈 생성 뒤 state 파일에서 분석 본문 사본 제거.
3. 분석 요청이 ready·approve·진행 중 running 을 덮지 않게(`shouldWriteNote`).

- 추가: `--no-write` 는 이슈·Slack 까지 모두 끔(시험 실행이 외부에 쓰지 않게).
