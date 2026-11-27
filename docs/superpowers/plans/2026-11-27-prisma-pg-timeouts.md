# 운영 504 정체 재발 방지 — 에이전트 토큰 lastUsedAt 락

## 장애 요약 (2026-11-27)

- 14:11~14:14 KST 에 시작한 요청 약 70건이 300초 대기 후 504 (`Vercel Runtime Timeout Error: Task timed out after 300 seconds`). DB 를 쓰는 모든 경로(`/api/sh/*`, `/api/mcp/mcp`, 워커 폴링)가 섞여 실패, 같은 배포의 다른 요청은 정상.
- Supabase postgres 로그(새 `logs` 테이블, `source='postgres_logs'`):
  - 프로세스 2072292 의 트랜잭션 479211 이 `AgentToken` 행 tuple (0,7) 락을 14:13 이전부터 **14:24:28** 까지 보유. 보유 프로세스는 문장 로그가 전혀 없음 → `idle in transaction` 상태로 판단.
  - 대기열: `UPDATE "AgentToken" SET "lastUsedAt" = $1 WHERE id = $2 AND (lastUsedAt IS NULL OR lastUsedAt < $3)` 가 반복적으로 락 대기 → 역할 `statement_timeout`(2min)으로 취소 → 다음 요청이 다시 대기.
- 직전 14:08·14:09 main 머지 → 운영 배포 2건(14:09~14:11) 으로 이전 인스턴스 교체.

## 원인

`src/lib/agent/identity/agent-token.ts:77` `verifyAgentToken` 이 `lastUsedAt` 갱신을 await 없이 실행한다.

1. Prisma 7 은 `updateMany` 를 트랜잭션으로 보낸다(dev 실측: `UPDATE …` 다음 `COMMIT` 이 별도로 나감).
2. 응답 후 실행되는 이 작업이 `UPDATE` 직후·`COMMIT` 전에 인스턴스 정지/교체(배포)로 끊기면, Supavisor 서버 연결에 커밋 안 된 트랜잭션이 남아 행 락을 계속 쥔다. 앱 역할의 `idle_in_transaction_session_timeout` 은 `0`(무제한, dev 실측 `postgres` 역할).
3. 커밋이 안 됐으니 `lastUsedAt` 이 계속 오래된 값 → 이후 같은 토큰의 MCP 요청마다 갱신을 다시 시도하고 락에서 막힌다.
4. 운영 풀은 인스턴스당 연결 1개(`src/lib/prisma.ts` `max = 1`) → 막힌 갱신이 그 연결을 최대 2분 점유, 같은 인스턴스의 모든 요청이 뒤에 줄을 서서 300초 504.

한계: 보유 프로세스 2072292 의 문장 자체는 로그에 없다. 그 행에 쓰는 코드는 위 `updateMany` 와 `revokeAgentToken`(사용자 폐기 동작, 해당 시각 호출 흔적 없음)뿐이라 위 경로로 추정한다.

## 변경

### A. `lastUsedAt` 갱신이 락을 기다리지도 남기지도 않게 (`src/lib/agent/identity/agent-token.ts`)

`updateMany` 를 한 문장짜리 raw SQL 로 바꾼다.

```ts
prisma.$executeRaw`
  UPDATE "AgentToken" SET "lastUsedAt" = ${now}
  WHERE "id" IN (
    SELECT "id" FROM "AgentToken"
    WHERE "id" = ${row.id} AND ("lastUsedAt" IS NULL OR "lastUsedAt" < ${cutoff})
    FOR UPDATE SKIP LOCKED
  )`.catch(...)
```

- dev 실측: `$executeRaw` 는 `COMMIT` 을 따로 보내지 않는다(자동 커밋 한 문장) → 클라이언트가 문장 전송 후 멈춰도 서버에서 문장이 끝나면 커밋된다. 열린 트랜잭션이 남지 않는다.
- `SKIP LOCKED`: 다른 세션이 그 행을 잡고 있으면 기다리지 않고 0행 갱신 → 연결 점유 없음.
- 기존처럼 await 하지 않고 실패는 로그만(인증 결과에 영향 없음). `after()`/`waitUntil` 은 넣지 않는다 — 한 문장 자동 커밋이라 응답 후 끊겨도 남는 상태가 없다.
- 테스트: `src/lib/agent/identity/__tests__/agent-token.test.ts` 의 `updateMany` 기대를 `$executeRaw` 호출로 바꾼다(id·cutoff 인자 확인).

### 하지 않는 것

- 앱 쪽 `query_timeout`·`connectionTimeoutMillis`(첫 계획) — 근본 원인과 맞지 않고, Codex 1차 검토 지적대로 서버 작업을 멈추지 못하며 `max=1` 대기열에서 정상 요청을 실패시킬 수 있다.
- `max = 1` 상향 — 별도 판단.
- B(앱 역할 `idle_in_transaction_session_timeout`) — 보류. Codex 2차 검토 high 3건(운영 마이그레이션 실행 계정·권한 미확인 시 `migrate deploy` 실패로 빌드 차단, `postgres` 공유 역할의 다른 세션 영향, `--create-only` 순서·롤백 시 기존 값 복원). 운영 역할·기존 설정을 읽기 전용으로 확인한 뒤 별도 계획으로 판단.

## 단계

1. dev 장애 주입으로 원인 재현(아래 결과).
2. A 구현 + 단위 테스트.
3. `npx jest src/lib/agent/identity`, lint, tsc(CI).
4. develop PR → main 릴리스, 배포 후 확인.

## 검증 결과 (dev DB, transaction pooler 6543, 2026-11-27)

- 기존 `updateMany` 를 `COMMIT` 직전에 `SIGKILL` → 소켓이 닫혀 Supavisor 가 롤백, 락 안 남음.
- 같은 지점에서 `SIGSTOP`(Vercel 인스턴스 일시정지 모사) → `pg_stat_activity` 에 `idle in transaction`(`UPDATE "AgentToken"…`)이 남고 행 락 유지. 기존 UPDATE 는 락 대기(3초 lock_timeout 으로 취소 확인), 새 문장은 0행·9ms.
- 새 Prisma `$executeRaw` 경로: `COMMIT` 별도 전송 없음, 락 없을 때 1행·락 보유 중 0행 179ms.
- 운영 증거와 일치: 락 보유 세션 문장 로그 없음(idle), 배포 직후, 같은 `UPDATE` 대기 반복.

## 배포 후 확인

- postgres 로그(`source='postgres_logs'`)에 `AgentToken` 락 대기 문구 없음.
- MCP 호출 후 `lastUsedAt` 갱신 정상(5분 간격).
- Vercel 5xx 30분 관찰.

## 롤백

- 커밋 revert 후 재배포(스키마·데이터 변경 없음).

## Codex 검토

- 1차(앱 쪽 시간 제한 계획): high 3건 → 근본 원인과 맞지 않아 계획 폐기.
- 2차(A+B): high 4·medium 1 → 원인 재현 지적은 장애 주입으로 반영, B 관련 4건은 B 보류로 반영.
