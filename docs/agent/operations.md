# 에이전트 운영 점검

## 결과 미확인 도구 호출 (ToolAuditLog)

`runTool`은 실행 전에 `outcome = 'started'` 행을 만들고 실행 뒤 `ok`/`error`로 갱신한다.
갱신이 실패하면 행은 `started`로 남는다 — 외부 쓰기가 실행됐는지 알 수 없다는 뜻이다.
이 행들은 자동으로 다시 실행하지 않는다. 사람이 외부 서비스 상태를 보고 판단한다.

```sql
SELECT id, "spaceId", "workId", tool, "actionId", "createdAt" FROM "ToolAuditLog"
WHERE outcome = 'started' AND "createdAt" < now() - interval '10 minutes' ORDER BY "createdAt" DESC;
```
