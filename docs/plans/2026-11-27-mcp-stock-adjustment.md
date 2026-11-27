# MCP 재고 조정 제안 도구 (sellerhub_propose_stock_adjustment)

## 목표

에이전트(에밀리 등)가 MCP로 「위치 X의 옵션 재고를 실물 N으로 맞추자」는 조정을 제안하고, 사람이 승인하면 화면의 「조정」과 같은 결과(InvStockLevel 절대값 설정 + ADJUSTMENT 이동 기록)가 남게 한다.

## 결정 (2026-11-27 에디 확인)

1. **항상 승인 후 실행** — `external: true`. 쓰기 권한(`sellerhub:write`)이 있어도 자동 실행하지 않는다. 재고는 발주·대조·판매 판단의 기준값이고, 사람이 관리하는 값을 덮어쓴다.
2. **승인 전 재고가 바뀌면 실패** — 제안 시점 재고(`expectedBefore`)를 파라미터에 기록하고, 실행 때 현재 재고와 다르면 액션 전체를 실패로 끝낸다(단일 트랜잭션 → 부분 반영 없음, `retryableAfterFailure: true`). 다시 제안하면 된다.
3. **자동 연동 위치 제외** — `externalSource`(예: 쿠팡 로켓그로스)가 있거나 `syncProvider && autoReconcileWeekly`(위킵 주간 자동 대조)인 위치, 비활성 위치는 거부.

## 기본값으로 정한 것

- 한 제안 = 위치 1곳 + 옵션 최대 50개. 같은 optionId 중복 거부.
- `quantity`는 실물 절대값(0 이상 정수). 현재 재고와 같으면(차이 0) 제안 단계에서 거부.
- `reason` 필수(1~500자). 이동 기록 reason에는 `${reason} (에이전트 제안 승인)`, `referenceId`에 actionId를 남겨 추적한다.
- `movementDate` 선택, 기본 KST 오늘.
- 멱등 키: 파라미터(+expectedBefore 포함) + KST 날짜.
- 같은 위치·옵션에 대한 PENDING 조정 제안이 이미 있으면 거부(키워드 도구와 같은 패턴) — 두 제안이 연달아 승인돼 서로 덮어쓰는 일 방지. (expectedBefore 검사로도 두 번째는 실패하지만 큐 혼란을 줄인다.)

## 변경 파일

1. `src/lib/agent/actions/seller-hub.ts` — 액션 `seller-hub.stock.adjust`
   - paramsSchema: `{ locationId, items: [{ optionId, quantity, expectedBefore }] (1~50), reason, movementDate? }`
   - `external: true`, `scope: 'sellerhub:write'`, `requiredRole: 'ADMIN'`, `retryableAfterFailure: true`
   - `validateCreate`: 위치(같은 Space·활성·자동 연동 아님), 옵션(같은 Space, 삭제 안 됨), 중복 optionId, 차이 0, expectedBefore == 현재, PENDING 중복
   - `snapshot`: 위치명 + 옵션별 `{name, sku, before, after, diff}` (승인 화면에서 전후 확인)
   - `execute`: `prisma.$transaction` 하나에서 위치 재검증 → 옵션마다 `lockStockLevel` → 현재 ≠ expectedBefore면 throw → `setStockLevel` → `invMovement.create(ADJUSTMENT, quantity=delta)`
   - `resultUrl`: `/d/seller-ops/inventory/movements?spaceId=`
2. `src/lib/inv/movement-processor.ts` — `setStockLevel`, `assertOptionInSpace` export (로직 변경 없음)
3. `src/lib/agent/tools/write-tools.ts` — 도구 `sellerhub_propose_stock_adjustment`
   - 입력: `locationId`, `items: [{ optionId, quantity }]`, `reason`, `movementDate?`
   - 현재 위치 재고를 읽어 `expectedBefore`를 서버가 채운다(에이전트가 넘기지 않음)
   - 요약: `재고 조정 제안: <위치명> · 옵션 N개 (+a/-b)`
   - 설명에 「위치 id·현재 재고는 sellerhub_get_stock_status(productId 필터) matrix로 확인, 승인 후 반영, 실행 전 사용자 확인」 명시
4. 테스트: `src/lib/agent/actions/__tests__/stock-adjust-action.e2e.test.ts` (reorder/keyword e2e 패턴)
   - 정상 승인 → 재고·이동 기록, 자동 실행 안 됨(pending_approval), 재고 변동 후 승인 → FAILED + 변경 없음, 자동 연동 위치 거부, 차이 0 거부, 다른 Space 옵션 거부
5. `scope-contract`·`write-tools-contract` 테스트가 도구 목록을 검사하면 갱신

## 단계

1. 액션 + export → 2. 도구 → 3. 테스트(e2e는 dev DB, `--runInBand`) → 4. tsc/lint → 5. develop PR → 로컬 MCP 호출로 제안·승인 확인 → release

## 검증

- 단위/e2e 테스트, tsc, eslint
- 로컬 dev에서 MCP 도구 호출(토큰) → 승인 큐에 표시 → 승인 → 입출고 목록에 조정 기록·재고 반영 확인 → QA 데이터 정리

## 위험·롤백

- 스키마 변경 없음. 롤백 = 도구·액션 제거 revert. 이미 반영된 조정은 입출고 화면에서 되돌리기(reverseMovement) 가능.
- 위험: 승인자가 내용을 안 보고 Slack에서 일괄 승인 → snapshot 전후 표시로 완화. 필요하면 `requiresWebReview`로 웹 단건 승인 강제(보류: 과함).
- 에밀리 프롬프트에 도구 사용 안내 추가는 범위 밖(도구 description으로 충분, 필요 시 후속).

## Codex 적대 검토 반영 (2026-11-27, 지적 6건 — 반영 5, 부분 반영 1)

1. **[high] 수량만 비교하면 10→15→10 변경을 놓침 → 반영.** 파라미터에 `expectedUpdatedAt`(재고 행 `updatedAt` ISO, 행이 없으면 null)을 함께 저장한다. 실행 때 수량과 updatedAt이 모두 같아야 통과한다. `InvStockLevel.updatedAt`은 `@updatedAt`이고, src/lib/inv에는 재고 행을 raw SQL로 쓰는 곳이 없다. 테스트에 「다른 값으로 바뀌었다가 원래 값으로 돌아온 경우 실패」를 넣는다.
2. **[high] 실행 시 옵션 재검증이 없음 → 반영.** 트랜잭션 안에서 옵션마다 `deletedAt IS NULL`, 상품의 `spaceId`가 같은지, 상품이 `ACTIVE`인지 다시 확인한다. `validateCreate`도 같은 조건을 쓴다. 기존 `assertOptionInSpace`는 deletedAt을 보지 않아 쓰지 않고 액션 안에서 직접 조회한다.
3. **[high] Slack·일괄 승인으로는 전후 확인이 안 됨 → 반영.** `requiresWebReview: () => true`로 웹 상세 단건 승인만 받는다. snapshot은 평탄한 key→string(`"<옵션명> (<SKU>)": "3 → 5 (+2)"`)으로 만든다. 승인 상세의 `toEntries`가 이 형태를 그대로 읽기 좋게 보여 준다. summary에도 위치명, 옵션 수, 증감 합계를 넣는다. snapshot 실패를 거부로 바꾸지는 않는다(부분 반영). 이유: snapshot은 validateCreate가 방금 성공한 것과 같은 조회만 하고, 거부하려면 공용 `createPendingAction` 규약을 바꿔야 한다.
4. **[high] 재고 행이 없으면 FOR UPDATE가 아무것도 잠그지 않음 → 반영.** 옵션마다 `upsertStockLevel`과 같은 `pg_advisory_xact_lock(hashtext(optionId||':'||locationId))`을 먼저 잡고, 그다음 `lockStockLevel` → 재조회 → 검증 순서로 진행한다. 교착을 피하려고 items는 optionId 순으로 정렬한 뒤 잠근다.
5. **[medium] PENDING 중복 조회는 동시 제안을 못 막음 → 문서화.** 중복 차단은 best-effort다. 동시에 들어온 두 제안이 모두 승인돼도 1번의 updatedAt 검사 때문에 두 번째는 실패하므로 재고가 잘못 덮어써지지 않는다.
6. **[medium] 롤백 절차 미흡 → 반영(문서).** 아래 롤백 항목을 보강한다.

## 롤백 (보강)

- 코드 롤백(revert) 시: 남은 PENDING `seller-hub.stock.adjust` 제안은 승인 때 알 수 없는 액션으로 FAILED 처리되고 재고는 바뀌지 않는다. revert 전에 `AgentPendingAction`에서 해당 actionType의 PENDING 건을 조회해 거절 처리한다.
- 이미 실행된 조정: 이동 기록을 삭제하거나 역산하지 않는다. `referenceId = actionId`로 해당 기록을 찾는다. 현재 실물을 다시 센 뒤 화면의 「조정」으로 새 보정 기록을 남긴다(추적이 남음).
