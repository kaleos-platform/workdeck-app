# Sentry 오류 자동 수정 러너 (dry 경로)

맥미니에서 매일 미해결 Sentry 이슈를 골라 Codex 로 수정안(patch)을 만들고, **승인 대기 묶음(pending)** 으로만 남긴다.
이 버전에는 push·PR·Sentry 노트 쓰기 코드가 **없다**(Sentry 는 GET 만). publish 는 dry 1주 검증 뒤 별도 구현한다.
명세: `docs/superpowers/plans/2026-11-21-sentry-autofix-loop.md` Phase 3.

## 구조

| 파일           | 역할                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `run.mjs`      | 오케스트레이터(호스트, 토큰 보유, LLM 없음). 사전 점검 → lock → 선정 → 이슈별 컨테이너 단계 → Slack 요약                        |
| `lib.mjs`      | 순수 함수(선정·scrub·컨텍스트·patch 검사·유출 대조·리뷰 JSON·템플릿)                                                            |
| `lib.test.mjs` | `node --test` (단위 + docker·slack·fetch·gitleaks 대역 통합 테스트)                                                             |
| `docker/proxy` | 인증 프록시(Node 내장만, `check.mjs` 순수 검사 + `server.mjs`). 전용 `auth.json` 을 읽기 전용 파일로 **이 컨테이너에만** 마운트 |
| `docker/codex` | 샌드박스 이미지(codex CLI 고정, 비 root). 토큰·auth 파일·프록시 환경 변수 없음                                                  |
| `prompts/`     | 수정·리뷰 프롬프트(보안 경계 아님)                                                                                              |
| `fixtures/`    | 주입 검증용 가짜 이슈 4종(`--fixture`)                                                                                          |

이슈당 흐름: `git clone`(호스트, `.git` 은 컨테이너에 안 줌) → `git archive` export → 설치(외부망, `npm ci --ignore-scripts`) → `patch-package --error-on-fail`(망 없음)
→ 수정(내부망, 인증 프록시만 도달 가능. 컨테이너에는 토큰이 없고 CODEX_HOME 은 빈 tmpfs, 커스텀 model_provider) → patch 생성(망 없음, 별도 컨테이너) → 호스트 검사(금지 경로·200줄·억제 주석·인코딩 문자열·기존 테스트 변경·원문 조각·토큰 조각·gitleaks)
→ 독립 검증(새 export + patch, 망 없음, eslint·tsc·jest 결과: 종료 코드와 jest 결과 JSON) → 리뷰(새 세션, JSON 스키마 검사, 파싱 실패 = blocking; blocking 이면 1회 재시도).

산출물은 `~/.local/state/workdeck-autofix/pending/<runId>-<shortId>/` 에 읽기 전용으로 남는다
(`patch.diff`·`pr-title.txt`·`pr-body.md`·`analysis.md`·`verify.json`·`manifest.json`; 검사에 걸리면 `manifest.status = blocked`, 토큰 조각이 나오면 `quarantine/` 로 격리).
이미 pending 이 있는 이슈는 다음 실행에서 다시 선정하지 않는다(그 뒤에 운영자가 `autofix:request` 를 남기면 다시 선정). 처리 후 작업 export 는 망 없는 정리 컨테이너가 지우고(호스트는 컨테이너가 만진 디렉터리를 `rmSync` 하지 않는다), 로그만 최근 3개 run 보존한다.

## 설치

```bash
cd scripts/sentry-autofix
docker build -t workdeck-autofix-proxy:latest docker/proxy
docker build -t workdeck-autofix-codex:latest docker/codex
# 망(workdeck-autofix-ext / workdeck-autofix-int)은 run.mjs 사전 점검이 없으면 만든다(이름이 겹치지 않는 자기 망만)
```

- 전용 Codex 로그인: `CODEX_HOME=~/.config/workdeck/autofix-codex codex login --device-auth` (호스트 `~/.codex` 는 읽지도 마운트하지도 않는다). 프록시는 토큰을 갱신하지 않는다 — access token 은 약 10일마다 재로그인이 필요하다(만료 72시간 전부터 Slack 경고, 2시간 미만이면 사전 점검 실패)
- 비밀값: `~/.config/workdeck/sentry-autofix.env`(600) — `SENTRY_API_TOKEN`(필수), `SENTRY_ORG`·`SENTRY_PROJECT`(선택, 기본 kaleos / workdeck-app)
- 필요 도구: Docker(OrbStack), `gitleaks`, `slack-post`, Node 22+
- launchd: `mkdir -p ~/Library/Logs/workdeck-autofix && cp ai.workdeck.sentry-autofix.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/ai.workdeck.sentry-autofix.plist`
  (plist 의 경로는 전용 체크아웃 `~/projects/kaleos/workdeck-autofix` 기준 — 이 스크립트가 develop 에 들어간 뒤 맞춘다)

## 테스트

```bash
node --test scripts/sentry-autofix/lib.test.mjs                                # 단위 + 대역 통합
AUTOFIX_DOCKER_TEST=1 node --test scripts/sentry-autofix/integration.test.mjs  # 실제 docker(악성 수정 흉내, 외부망·수 분 소요)
```

## 실행

```bash
node scripts/sentry-autofix/run.mjs                                   # 일일 선정(최대 3건)
node scripts/sentry-autofix/run.mjs --issue WORKDECK-APP-1A            # 수동 1건(처리 기록 무시)
node scripts/sentry-autofix/run.mjs --fixture scripts/sentry-autofix/fixtures/inject-host-files.json --no-slack
```

`--no-slack` 이면 Slack 대신 stdout. 종료 코드: 0 정상, 1 사전 점검·실행 오류, 2 인자 오류. 전체 45분 deadline, 동시 실행은 lock(`~/.local/state/workdeck-autofix/lock`)으로 막는다.
컨테이너는 이름 + 라벨 `workdeck.autofix=<runId>` 로만 식별해 `docker kill` 한다. `docker prune` 등 이름 없는 삭제는 쓰지 않는다(공용 호스트).

## 주의·한계

- **프록시가 중계하는 것**: `POST /v1/responses`·`GET /v1/models` 만 고정 업스트림(`chatgpt.com/backend-api/codex/*`)으로 간다. 클라이언트 authorization·cookie·계정 헤더는 버리고 프록시가 붙인다. 본문은 JSON 만(압축 거부)·크기 상한·모델 고정·tools 는 function/custom/local_shell 만(web_search 등 서버 실행 도구 거부)·원격 image/file 참조 거부·알 수 없는 input 항목 거부·이슈당 요청 수 상한. 오류 컨텍스트(스크럽된 것)는 모델로 간다는 잔여 위험은 남는다.
- **프록시 보호**: run 마다 32바이트 임의 비밀값을 `--env-file`(0600, 실행 뒤 삭제)로 프록시(`PROXY_SECRET`)와 codex provider 헤더(`env_http_headers`)에만 전달한다(docker 인자·프로세스 목록에 값이 보이지 않음). 프록시는 `timingSafeEqual` 로 비교해 불일치는 403, 동시 처리 4개·이슈당 요청 150개(거부 요청 포함)·로그 500줄 상한, 응답은 `stream.pipeline`, 클라이언트가 끊으면 업스트림도 중단한다. 요청 본문은 검사한 객체만 다시 직렬화해 보낸다(상위 키·도구 필드·content 종류 허용 목록, `store=false` 강제, JSON 중첩 32단계 상한).
- **공용 장애 구분**: 업스트림 401/403/429/5xx·upstream 오류·프록시 소멸은 그 이슈 탓이 아니라 run 을 중단하되 이슈별 실패 횟수에는 센다(3회면 일일 선정에서 제외, 마지막 실패보다 뒤의 `autofix:request` 가 있으면 초기화, Slack 에 shortId 표시). 프록시 자체의 request-cap 은 이슈 실패로 기록한다.
- **디스크 감시**: 3초마다 확인해 이슈 시작 대비 15GB 감소 또는 여유 15GB 미만이면 이 run 컨테이너를 이름으로 kill 하고 run 을 중단한다. 정리 컨테이너 실패는 Slack 경고로 알린다.
- **컨텍스트 선정의 한계**: Sentry 조회가 25건(`limit=25`)이라 `autofix:request` 노트가 사용자 수 정렬 25위 밖인 이슈는 일일 선정에서 보이지 않는다. 그 이슈는 `--issue <shortId>` 로 수동 실행한다.
- **디스크**: bind mount 라 쓰기 크기를 docker 가 제한하지 못한다. 대신 사전 점검(여유 20GB 이상)과 실행 중 감시(여유 3GB 미만이면 이 run 컨테이너를 이름으로 kill 하고 run 중단)로 막는다.
- **worker/ 변경은 차단**한다(검증의 tsc 가 worker 를 보지 않음). 허용 경로는 `src|app|components` 아래 `.ts/.tsx/.css` 뿐이다.
- 검증하지 않은 단계는 PR 본문·Slack 에 "미실행"으로 표시한다.

- Slack 에는 요약(상태·파일 수·검증 결과·사유 코드)만 간다. Codex 원문 분석·원본 오류 메시지는 싣지 않는다.
- 토큰 조각 대조는 16자 미만 분할·임의 인코딩을 **검출하지 못한다**. publish 전 사람이 patch·PR 제목·본문 원문 전체를 읽는 것이 최종 경계다.
- 컨테이너가 auth.json 을 받지 않으므로 컨테이너 쪽 되돌림·JWT 비교는 없다. 호스트는 auth.json 의 모든 문자열 값(16자 이상)을 patch·analysis·PR 문구와 대조하는 이중 안전장치만 유지한다. 사전 점검의 만료 확인은 JWT payload 의 `exp` 만 읽으며 **서명은 검증하지 않는다**.
- 관련 jest 테스트가 0개면 verify.jest 는 `no-tests`(검증 실패 아님)로 기록하고 본문·Slack 에 "관련 테스트 없음"으로 표시한다.
- 45분 한도는 이슈당이다(하루 최대 3건). 한도를 넘으면 그 run 의 컨테이너만 이름으로 kill 한다.
- patch 없이 끝난 실패(fix 실패·timeout·설치 실패 등)도 `pending/<runId>-<shortId>/manifest.json`(상태·사유만)을 남겨 다음 날 재시도하지 않는다. 운영자가 그 뒤에 `autofix:request` 를 남기면 다시 선정한다.
- 수정된 소스가 jest 프로세스 안에서 돌기 때문에 검증은 완전한 독립이 아니다.
- Sentry 노트는 쓰지 않으므로 어드민에는 running·analysis 가 표시되지 않는다.

## 중지·폐기

- 중지: `launchctl unload ~/Library/LaunchAgents/ai.workdeck.sentry-autofix.plist`
- 이상 징후(토큰 조각 검출 등): 위 unload → `~/.config/workdeck/autofix-codex` 삭제 → pending 의 `quarantine/` 는 사람이 확인 후 삭제
- **유출이 의심될 때(ChatGPT 계정 세션 해제)**: ① unload ② chatgpt.com 에 러너 전용 계정으로 로그인 → Settings → Security(보안)에서 모든 기기 로그아웃(Log out of all devices) 으로 세션·refresh token 을 폐기 ③ `autofix-codex` 디렉터리 삭제 후 재로그인 ④ 공개된 branch·PR 이 있으면 삭제하고 에디에게 보고(이미 공개된 내용은 회수 불가로 본다)
- 이전 run 의 잔재 컨테이너는 다음 실행 시작 때(lock 을 쥔 상태에서) 라벨 `workdeck.autofix` + 이름 `workdeck-autofix-` 접두인 것만 이름으로 kill 한다. SIGTERM/SIGINT 를 받으면 이 run 의 컨테이너를 정리하고 lock 을 푼다. lock 은 원자적(link)이며 4시간이 넘으면 회수한다.
