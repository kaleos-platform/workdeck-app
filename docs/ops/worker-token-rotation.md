# 워커 토큰(WorkerToken) 교체 런북

워커(맥미니 상주 runner 등)는 Space 범위 토큰(`wdw_…`)으로 웹앱에 인증한다.
토큰은 `worker/.env` 의 `WORKER_API_KEY` 값으로 들고 있고(`worker/src/api-client.ts`),
요청 헤더는 기존과 같은 `x-worker-api-key` 다. 토큰에는 만료(`expiresAt`)가 있어서
만료 전에 사람이 새 토큰으로 바꿔야 한다. 만료되면 그 순간부터 워커 요청이 401 로 실패한다.

- 발급 TTL: 기본 90일, 최대 365일(`--ttl-days`). 만료 없는 토큰은 만들지 않는다.
- DB 에는 sha256 해시만 저장한다. 평문은 `issue` 때 한 번만 출력되므로 바로 워커에 넣는다.
- 스크립트는 `.env.local` 의 `DATABASE_URL` 로 접속한다. 대상 환경의 DB URL 인지 먼저 확인한다.

## 월 1회 만료 점검

운영 체크리스트(월 1회)에 넣는다.

```bash
npx tsx scripts/security/worker-token.ts list --space <spaceId>
```

`revokedAt` 이 비어 있는 토큰의 `expiresAt` 이 **14일 이내**면 아래 교체 절차를 바로 진행한다.
`lastUsedAt` 이 오래 멈춘 토큰은 쓰이지 않는 것이니 폐기를 검토한다(5분 단위로만 갱신된다).

## 교체 절차

1. **새 토큰 발급.** 이 시점부터 옛 토큰과 새 토큰이 모두 유효하다.

   ```bash
   npx tsx scripts/security/worker-token.ts issue --space <spaceId> --name macmini-<위치> [--ttl-days 90]
   ```

   출력의 토큰 id(`발급: <id>`)를 기록한다. 토큰 평문은 채팅·티켓·커밋에 붙이지 않는다.

2. **워커 `.env` 교체** (맥미니, `worker/` 디렉터리). 셸 기록에 남지 않게 `read -rs` 로 받는다.

   ```bash
   read -rs T   # 새 토큰 붙여넣고 Enter
   tmp="$(mktemp)"   # mktemp 파일은 600 으로 만들어진다
   grep -v '^WORKER_API_KEY=' .env > "$tmp"
   printf 'WORKER_API_KEY=%s\n' "$T" >> "$tmp"
   mv "$tmp" .env && chmod 600 .env
   unset T
   ```

3. **워커 재시작.**
   - 맥미니(launchd): `launchctl kickstart -k gui/$UID/ai.workdeck.coupang-worker`
   - PM2 로 띄운 환경: `npx pm2 restart workdeck-worker` (`worker/ecosystem.config.cjs`)

4. **새 토큰 사용 확인.** 다음 폴링 뒤(최대 몇 분) `list` 에서 새 토큰의 `lastUsedAt` 이 채워지는지 본다.
   비어 있으면 옛 토큰을 폐기하지 말고 워커 로그의 401 여부와 `.env` 값을 확인한다.

5. **옛 토큰 폐기.**

   ```bash
   npx tsx scripts/security/worker-token.ts revoke --id <옛 토큰 id>
   ```

토큰이 유출됐다고 의심되면 1~5 를 즉시 진행하되, 4 를 기다리지 말고 옛 토큰을 먼저 폐기해도 된다
(워커는 새 토큰을 넣을 때까지 멈춘다).

## 레거시 단일 키(`WORKER_LEGACY_KEY_ENABLED`)

- 전환 기간에만 서버 env `WORKER_LEGACY_KEY_ENABLED=1` 로 기존 단일 키(`WORKER_API_KEY`)를 허용한다.
  레거시 키는 범위 제한이 없다(모든 Space).
- 서버의 레거시 `WORKER_API_KEY` 는 `wdw_` 로 시작하면 안 된다. 그 경우 토큰 경로로만 해석돼 레거시 분기에
  도달할 수 없으므로 서버가 설정 오류로 throw 한다(500). 레거시 키를 새로 만들지 말고 워커 토큰을 발급한다.
- 모든 워커가 `wdw_` 토큰으로 바뀌고 `lastUsedAt` 으로 사용이 확인되면 플래그를 끄고(env 삭제 후 재배포)
  레거시 분기를 지운다. 첫 전환과 플래그 해제는 계획 (a) Task 7 Step 8 에서 한다.
