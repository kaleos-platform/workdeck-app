# Sentry 자동 수정 러너 — 전용 Codex 토큰 호스트 자동 갱신

작성 2026-11-24. 상위 계획: `2026-11-21-sentry-autofix-loop.md`(Phase 3, 인증 프록시).

## 목표

전용 Codex 로그인(`~/.config/workdeck/autofix-codex/auth.json`)의 access token 수명은 10일 고정이고, 인증 프록시는
auth.json 을 읽기 전용으로 쓰기 때문에 10일마다 사람이 `codex login --device-auth` 를 다시 해야 한다.
러너가 **호스트에서** Codex 공식 갱신 경로로 토큰을 갱신해, 매일 도는 동안 재로그인이 필요 없게 한다.
토큰을 컨테이너에 넣지 않는 기존 경계는 그대로 둔다.

## 갱신 수단 (확인됨)

- Codex CLI 0.167 `codex app-server`(stdio JSON-RPC)의 `account/read` 에 `refreshToken: true` 를 주면
  "managed auth mode 에서 정상 refresh-token 흐름을 실행"(생성 스키마 `v2/GetAccountParams.json` 설명).
  갱신·저장(auth.json 쓰기·`auth.json.lock`)은 Codex 가 직접 한다 → client_id·토큰 엔드포인트를 우리가 하드코딩하지 않는다.
- 스파이크(11-24): `initialize` → `initialized` → `account/read {refreshToken:false}` 응답 정상, auth.json 해시 불변.
  `refreshToken:true` 는 구현 후 1회 실행으로 확인(아래 검증).
- 모델 호출·에이전트 실행 없음. 전용 CODEX_HOME 의 config.toml 에 MCP 서버 없음(`projects."/work"` trust 만).

## 변경 파일

1. `scripts/sentry-autofix/run.mjs`
   - `cfg.authRefreshHours = 168`(남은 시간 7일 이하일 때만 갱신 → 약 3일마다 1회).
   - `deps.refreshAuth(cfg)`: `codex app-server` 를 `env -i` 수준 최소 환경(PATH·HOME·CODEX_HOME)으로 띄워
     위 3개 메시지 전송, `id:2` 응답(또는 error)까지 대기, 타임아웃 60초 후 종료. stdout 은 파싱만 하고 **로그·Slack 에 남기지 않는다**
     (email·account id 포함). 결과 `{ ok, error? }` 만 반환(error 는 메시지 종류만, 원문 미포함).
   - `preflight`: 기존 만료 확인 **전에** 남은 시간 ≤ `authRefreshHours` 이면 `refreshAuth` 호출 → auth.json 다시 읽어
     exp 가 늘었는지 확인. 실패·미증가 시 `warnings` 에 "토큰 자동 갱신 실패 — 재로그인 필요할 수 있음" 추가(사전 점검 실패로 바로 막지 않음).
     이후 기존 `authMinHours`·72시간 경고 판정은 그대로(갱신된 토큰 기준).
   - `codex` 실행 파일이 없으면 갱신 건너뛰고 경고.
2. `scripts/sentry-autofix/lib.test.mjs`(또는 run 단위 테스트 위치): preflight 갱신 분기 테스트 —
   (a) 7일 초과면 호출 안 함 (b) 7일 이하면 호출, 성공 후 exp 증가 → 경고 없음 (c) 실패 → 경고, 남은 시간 충분하면 problems 없음
   (d) 실패 + 3시간 미만 → 기존대로 problems. `deps.refreshAuth` 는 가짜로 주입.
   통합 테스트는 `deps.refreshAuth` 를 no-op 로 둬 실제 Codex 를 띄우지 않는다.
3. `scripts/sentry-autofix/README.md`: 36줄 "프록시는 토큰을 갱신하지 않는다 — 10일마다 재로그인" 문구를
   "러너가 사전 점검에서 호스트 Codex 로 자동 갱신(7일 이하일 때). 실패 경고가 오면 재로그인" 으로 바꾼다.

## 보안 고려

- 갱신은 호스트 프로세스(러너와 같은 사용자)에서만. 컨테이너 마운트·인자 변화 없음.
- refresh token 회전: Codex 가 lock 을 잡고 저장하므로 동시 실행 시 Codex 가 처리. 러너는 launchd 1일 1회.
  수동 실행이 겹쳐도 preflight 의 갱신은 Codex lock 아래에서 직렬화된다.
- 프록시는 run 시작 때 auth.json 을 읽기 전용 마운트 → 갱신은 프록시 기동 전(preflight)에 끝난다.
- 호스트 이중 안전장치(`tokenWindows`)는 issue 처리 시점에 auth.json 을 다시 읽으므로 갱신된 값으로 대조.
  (이전 토큰 값은 대조 대상에서 빠지지만, 컨테이너는 어떤 토큰도 받은 적이 없다.)
- 유출 대응 절차(README "중지·폐기": 모든 기기 로그아웃)는 refresh token 도 폐기하므로 그대로 유효.
- 위험: 갱신 실패가 "로그아웃된 상태"(refresh token 무효)로 남으면 재로그인 필요 — 지금과 동일한 복구 경로.

## 단계

1. run.mjs 갱신 함수·preflight 분기 + 단위 테스트(TDD).
2. README 수정.
3. 단위 80+α 통과, 통합 9 통과(refreshAuth no-op).
4. 실제 1회: 운영 체크아웃이 아닌 이 워크트리에서 `refreshAuth` 만 단독 실행(남은 시간 무관 강제) → exp 증가·auth.json 권한 600 유지·
   `codex login status` 정상 확인. 출력 원문은 보지 않고 exp·해시 변화만 기록.
5. develop PR·머지 → 운영 체크아웃 `git pull --ff-only`(이미지 재빌드 불필요 — 호스트 스크립트만 변경).

## 검증

- 단위 테스트 분기 4종, 통합 9종.
- 실제 갱신 1회 후 exp(약 10일 뒤)·`last_refresh` 갱신 확인.
- 다음 launchd 실행 로그에 갱신 경고 없음 확인(7일 초과라 호출 안 함이 정상).

## 롤백

- develop revert 후 운영 체크아웃 pull. 토큰 상태는 그대로 유효(갱신된 토큰도 정상 토큰).
- 갱신이 로그인을 깨면: `CODEX_HOME=~/.config/workdeck/autofix-codex codex login --device-auth` 재로그인(현재 절차).

## Codex 계획 검토 반영 (2026-11-24, 지적 3건 — 반영 3)

1. [high] lock 밖 갱신 → **반영**: 갱신은 `preflight` 가 아니라 `runDaily` 에서 run lock 획득 직후·프록시 기동 전에 한다.
   preflight 는 지금처럼 읽기 전용 점검만(3시간 미만 실패 포함). 갱신 실패가 이어져 3시간 미만이 되면 어차피 재로그인이 필요하므로 이 순서로 충분.
   사람이 직접 `codex login` 하는 경우는 lock 밖이다 — 04:30 실행 시간대를 피하라고 README 에 적는다.
2. [high] 실제 갱신이 운영 로그인을 바꾼다 → **부분 반영**: 별도 계정이 없어 운영 자격증명으로 1회 확인한다.
   진행 중 run 이 없는지(lock 파일 없음, 04:30 와 떨어진 시각) 확인한 뒤 같은 코드 경로(`refreshCodexAuth`)로 실행.
   실패 시 복구는 재로그인(에디가 방금 한 것과 같은 절차) — 에디가 이 위험을 알고 1번 안을 선택함.
   응답(id:2)은 Codex 가 저장을 마친 뒤 오므로 정상 경로에서는 중간 kill 이 없다. 타임아웃은 120초로 넉넉히 두고, 넘으면 kill 후 경고.
3. [medium] 모의 테스트 한계 → **반영**: `refreshCodexAuth` 를 가짜 app-server 실행 파일(node 스크립트)로 실제 spawn 테스트 —
   분할 응답, error 응답, 응답 전 종료, 무응답 타임아웃, 자식 환경 allowlist(임의 비밀 변수 미전달), stdout·stderr 원문이 결과에 안 실림.
   stderr 는 `ignore`, stdout 은 JSON 파싱만 하고 결과는 고정 코드(`timeout`·`exited`·`refresh-error` 등)만.

## 구현 후 보안 리뷰 반영 (opus, blocking 0 · non-blocking 4 — 반영 4)

1. 만료 임박이면 preflight 가 먼저 막아 갱신 기회가 없음 → 3시간 미만 판정을 갱신 시도 **뒤**(lock 아래)로 옮김.
2. 갱신 블록이 try/finally 밖 → 기존 try 안으로, `refreshAuth` 예외는 `exception` 고정 코드 경고.
3. SIGTERM 무시 시 자식이 남음 → 5초 뒤 SIGKILL(unref).
4. 테스트: 만료 임박이어도 갱신되면 계속, 예외 시 경고·lock 해제 추가(실패+3시간 미만 = 기존 테스트).

## 실제 갱신 1회 (2026-11-24 22:57, 운영 lock 아래)

`{ok:true}`, 만료 12-04 22:51 → 12-04 22:57(KST, 발급 +10일), refresh token 회전, 권한 600 유지, `codex login status` 정상, lock 해제.
