# Sales Content Deck — 운영 가이드

맥미니 24/7 워커 + 웹앱 dev/prod 환경에서 **자동 콘텐츠 발행 + 성과 수집**을 운영할 때 필요한 절차를 모은 문서. 신규 환경 bring-up, 장애 대응, 정기 점검 시 참조.

---

## 1. 환경 변수 체크리스트

| 변수                                       | 필수     | 위치                    | 설명                                                                           |
| ------------------------------------------ | -------- | ----------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                             | ✅       | `.env.local`            | Supabase Postgres 접속 URL                                                     |
| `NEXT_PUBLIC_SUPABASE_URL`                 | ✅       | `.env.local`            | Supabase 프로젝트 URL                                                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`            | ✅       | `.env.local`            | Supabase anon key                                                              |
| `WORKER_API_KEY`                           | ✅       | `.env.local` + 워커 env | 웹앱 ↔ 워커 인증 키 (32+ random hex 권장)                                      |
| `ENCRYPTION_KEY`                           | ✅       | `.env.local`            | AES-256-CBC 키 (64-char hex). ChannelCredential 암복호화에 사용                |
| `NEXT_PUBLIC_APP_URL`                      | (운영)   | `.env.local`            | `/c/{slug}` CTA 링크 origin. 미설정 시 dev=localhost, prod=DEFAULT_APP_ORIGIN  |
| `OPENROUTER_API_KEY`                       | (선택)   | `.env.local`            | 기존 쿠팡 광고 분석 (sales-content 와 무관)                                    |
| `CLAUDE_CODE_ACP_ENDPOINT`                 | (Unit 3) | `.env.local`            | Bridge ACP 엔드포인트(미구현 시 Ollama fallback)                               |
| `OLLAMA_ENDPOINT` / `OLLAMA_MODEL`         | (Unit 3) | `.env.local`            | 로컬 Ollama (ACP fallback)                                                     |
| `GOOGLE_AI_API_KEY` / `GEMINI_IMAGE_MODEL` | (Unit 7) | `.env.local`            | Gemini 이미지 생성                                                             |
| `SALES_CONTENT_IMAGE_MONTHLY_QUOTA`        | (Unit 3) | `.env.local`            | 월 이미지 quota 기본값 (default 50)                                            |
| `SC_FAILURE_WEBHOOK_URL`                   | (선택)   | `.env.local`            | non-retryable job 실패 시 Slack-compat webhook (`{text}` POST). 미설정 시 noop |
| `SC_NAVER_HEADLESS`                        | (옵션)   | 워커 env                | `false` 면 Playwright headed 모드 (디버깅용). 기본 headless                    |

신규 환경 셋업 시 `cp .env.local.example .env.local` 후 채워넣고, `ENCRYPTION_KEY` 는 다음 명령으로 생성:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

> ⚠️ `ENCRYPTION_KEY` 변경 시 기존 ChannelCredential row 들은 복호화 불가 — 신규 환경에서만 키를 새로 생성하고, 기존 환경에서는 절대 변경 금지.

---

## 2. 프로세스 기동·종료

### 웹앱 (dev)

```bash
npm run dev   # http://127.0.0.1:3000
```

### sc 워커 (맥미니 상주)

```bash
cd worker
WORKER_API_KEY=... \
WEB_APP_URL=http://127.0.0.1:3000 \
npm run sc
```

- `runScLoop` 가 5초 주기로 PUBLISH·COLLECT_METRIC·INSIGHT_SWEEP job 을 polling
- SIGTERM/SIGINT 수신 시 다음 poll 후 graceful shutdown
- 운영 환경에서는 `pm2`/`launchd`/`systemd` 등으로 데몬화 권장

### `.env.local` 변경 후

Next.js 는 부팅 시 한 번만 `.env.local` 을 읽으므로 dev 서버를 **반드시 재시작**해야 새 값이 적용됨.

---

## 3. 채널 자격증명 (Naver) 운영 절차

### 세션 발급·갱신

Naver 세션은 약 **30일 만료**. 만료되면 Publisher 가 `AUTH_FAILED` 반환 후 즉시 FAILED 처리(재시도 안 함).

```bash
# 자동 (env NAVER_ID/NAVER_PW)
npx tsx scripts/sc/acquire-naver-session.ts --auto

# 또는 수동 (브라우저에서 직접 로그인)
npx tsx scripts/sc/acquire-naver-session.ts --manual
```

- 두 모드 모두 NID_AUT·NID_SES 쿠키 polling 으로 감지 후 `/tmp/naver-session.json` 에 storageState 저장
- 이후 채널 상세 페이지 → "네이버 자격증명 업로드" UI 에서 storageState.json + blogId 입력 → DB 저장

### 만료 감지

Publisher 가 `AUTH_FAILED` 반환 → `failJob({ nonRetryable: true })` → `SalesContentJob.status='FAILED'` + `ContentDeployment.status='FAILED'` + `errorMessage` 에 안내 메시지 저장. 운영자는 다음을 확인:

```bash
npx tsx scripts/sc/ops/db-stats.ts
# 출력 예: SalesContentJob 5 (PENDING=0, FAILED=2)
```

또는 SQL:

```sql
SELECT id, "errorMessage", "createdAt"
FROM "SalesContentJob"
WHERE status = 'FAILED' AND "errorMessage" LIKE '%세션이 만료%'
ORDER BY "createdAt" DESC LIMIT 10;
```

---

## 4. 스모크 테스트

신규 환경 bring-up 또는 worker contract 변경 후 회귀 검증:

```bash
# Terminal 1
npm run dev

# Terminal 2
cd worker && WORKER_API_KEY=... npm run sc

# Terminal 3
npx tsx scripts/sc/ops/smoke-e2e.ts --blogId meaning-lab
```

1. Space 결정(첫 활성 sales-content DeckInstance) → 채널/자격증명/콘텐츠/배포 시드
2. PUBLISH job enqueue
3. `ContentDeployment.status` polling (3분 timeout)
4. 결과 출력 (status / platformUrl / errorMessage)

`status="PUBLISHED"` 면 풀패스 정상. `status="FAILED"` + `errorMessage` 가 세션 만료면 storageState 갱신 필요(§3).

---

## 5. DB 상태 빠른 확인

```bash
npx tsx scripts/sc/ops/db-stats.ts
```

출력 예:

```
Space                 5
SalesContentChannel   1
ChannelCredential     1
Content               1
ContentDeployment     1 (PUBLISHED=0, FAILED=1)
SalesContentJob       1 (PENDING=0, FAILED=1)
```

- Credential=0: 채널 자격증명 미등록 → UI 또는 smoke 에서 업로드
- Job 모두 FAILED: AUTH_FAILED · 코드 버그 등 시스템 이슈 확인 필요
- Deployment FAILED 비율 ↑: 세션 만료 의심

---

## 6. errorCode 정책

| 코드              | 재시도 | 의미                                     |
| ----------------- | ------ | ---------------------------------------- |
| `NETWORK`         | ✅     | 일시적 네트워크 오류 — 백오프 후 재시도  |
| `PLATFORM_ERROR`  | ✅     | 플랫폼 일시 오류 (DOM 변경, timeout 등)  |
| `AUTH_FAILED`     | ❌     | 자격증명 만료/무효 — 운영 갱신 필요      |
| `RATE_LIMITED`    | ❌     | 플랫폼 quota 초과 — 다음 사이클 대기     |
| `VALIDATION`      | ❌     | 입력 데이터 문제 — 코드/콘텐츠 수정 필요 |
| `NOT_IMPLEMENTED` | ❌     | 채널·publisherMode 조합 미구현           |

retry 가능 여부는 `src/lib/sc/jobs.ts` 의 `RETRYABLE_ERROR_CODES` allowlist 로 관리. 새 코드 추가 시 의도적으로 retryable 인지 판단 후 등록(기본 non-retryable).

---

## 7. INSIGHT_SWEEP (셀프-임프루빙 루프)

주 1회 cron 으로 활성 Space 전체 sweep:

```bash
curl -X POST http://127.0.0.1:3000/api/sc/insights/schedule \
  -H "x-worker-api-key: $WORKER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"allSpaces":true}'
```

- 최근 N일 PUBLISHED 배포가 있는 Space 만 대상
- 12시간 내 같은 Space 에 PENDING/CLAIMED INSIGHT_SWEEP 있으면 중복 enqueue 방지

---

## 8. 운영 검증 체크리스트

신규 환경 bring-up 또는 코드 변경 후 production-ready 여부 확인용. 모두 ☑ 면 합격.

### 8-1. 사전 점검 (코드 측)

- [ ] `npm test` — 20 suites / 166 tests green
- [ ] `npx tsc --noEmit` — webapp 0 errors
- [ ] `cd worker && npx tsc --noEmit` — worker 0 errors
- [ ] `npx tsx scripts/sc/ops/smoke-e2e.ts --help` 정상 출력 (env 미설정에서도 동작)

### 8-2. End-to-End 발행 검증

```bash
# Terminal 1: webapp
npm run dev

# Terminal 2: worker
cd worker && WORKER_API_KEY=$WORKER_API_KEY npm run sc

# Terminal 3: smoke
npx tsx scripts/sc/ops/smoke-e2e.ts --blogId <id> --json | tee /tmp/smoke.json
```

- [ ] 종료 코드 `0` (`status=PUBLISHED`)
- [ ] `/tmp/smoke.json` 의 `platformUrl` 이 실제 네이버 포스트로 열림
- [ ] `db-stats` 출력에 ContentDeployment(PUBLISHED=+1) 반영
- [ ] worker 로그에 `[sc-runner] poll 완료 — processed=1, failed=0` 라인

### 8-3. webhook 알림 검증

```bash
# .env.local 에 SC_FAILURE_WEBHOOK_URL 추가 후 dev 재시작
# 의도적 실패 — 잘못된 storageState 로 시도
echo '{"x":1}' > /tmp/bad-session.json
npx tsx scripts/sc/ops/smoke-e2e.ts --blogId test --sessionFile /tmp/bad-session.json
```

- [ ] Slack(또는 webhook 수신처) 에 `🚨 sales-content job 실패` 메시지 도착
- [ ] 메시지에 자격증명 토큰/Bearer 등이 노출되지 않음 (redaction 확인)
- [ ] retryable 실패(network 일시 오류) 시에는 webhook 가 호출되지 않음 — 의도된 동작

### 8-4. reaper 동작 검증

수동으로 stale CLAIMED 1건을 만들어 회복 확인:

```sql
-- 가장 최근 PUBLISHED job 1건을 CLAIMED + 11분 이전 claimedAt 으로 강제 변환
UPDATE "SalesContentJob"
SET status='CLAIMED', "claimedBy"='manual-test', "claimedAt"=NOW() - INTERVAL '11 minutes'
WHERE id = (SELECT id FROM "SalesContentJob" WHERE status='COMPLETED' ORDER BY "completedAt" DESC LIMIT 1);
```

다음 polling 사이클 (≤5초) 후 worker 로그에 `[sc-jobs-worker] stale CLAIMED 1건 회복` 확인:

- [ ] 위 row 의 status 가 `PENDING` 으로 돌아감
- [ ] `claimedBy`, `claimedAt` 이 `NULL`
- [ ] `attempts` 는 그대로 보존 (정책)

### 8-5. metrics chunking 검증 (선택)

대량 백필 시뮬레이션 — Collector 가 70+ metrics 반환하는 시나리오:

- [ ] webapp 로그에 metrics worker 라우트 200 응답이 **2회** 기록 (50 + 20 chunk)
- [ ] DB `DeploymentMetric` row 수가 입력 metrics 수와 일치

### 8-6. 헬스 체크 자동화

CI/cron 에서 실행 가능한 한 줄 헬스 체크:

```bash
npx tsx scripts/sc/ops/healthcheck.ts --blogId <id>
# exit 0=PUBLISHED, 1=FAILED, 2=폴링 timeout 또는 인프라 오류
```

내부적으로 `smoke-e2e --json` 을 실행하고 결과를 파싱해 단일 라인 상태 + exit code 만 반환.
배포 직후 회귀 알람용으로 cron 에 등록 가능 (예: `*/30 * * * *`).

---

## 9. 알려진 한계 / 후속 작업

- **Bridge ACP 라우트 미구현**: `POST /sales-content/generate` 가 외부 `claude-code-bridge` 에 추가 필요. 미구현 시 Ollama fallback 또는 503.
- **Threads API**: Meta OAuth 앱 승인 대기 중. 현재 Publisher/Collector 모두 `NOT_IMPLEMENTED` 반환.
- **실패 알림**: `SC_FAILURE_WEBHOOK_URL` 설정 시 non-retryable job 실패 즉시 Slack 호환 webhook 으로 전송. 미설정 환경에서는 `db-stats` / SQL 로 fallback 모니터링.
- **세션 자동 갱신**: `--auto` 모드는 ID/PW env 가 있어야 동작. 2FA 필요 시 `--manual` 사용.
