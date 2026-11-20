# 생산 입고 완료와 재고 입고 분리

## 목표

재고 증감은 재고 위치의 [입고] 건(InvMovement INBOUND)으로만 일어나게 한다. 생산 차수의 「입고 완료」는 원가·위치별 입고 물량 기록용 상태 전환만 한다.

- 쿠팡·위킵(연동 위치): 지금처럼 재고를 늘리지 않음. 대조 확정 전까지 「입고 예정」(#1379 그대로).
- 사무실 등 자체 위치: **자동 INBOUND 제거.** 사용자가 선택할 때만 「사무실 입고 등록」으로 INBOUND 생성.
- 롯데택배(공장 직배송): 배송 방식의 출고 위치(`DelShippingMethod.locationId`)를 비우면 차감 없음 — 사용자 설정 완료, 코드 변경 없음.

## 확정 결정 (에디, 2026-11-20 grill)

1. 사무실 입고 등록은 **기본 해제(선택)**. 입고 완료 시점뿐 아니라 **입고 완료 이후에도** 차수에서 등록 가능.
2. 미등록 자체 위치 분배분은 연동 위치와 같은 규칙으로 「입고 예정」: ① 그 차수·옵션·위치 입고 등록, ② stockedInAt 이후 그 위치 대조 확정, ③ 기존 대기 한도(`EXTERNAL_PENDING_MAX_DAYS`) 경과 중 먼저 오는 것까지.
3. **입고 완료 되돌리기 허용**: 그 차수로 등록된 입고(INBOUND referenceId `prodrun:<runId>:…`)가 없을 때만 → ORDERED. 분배 기록·stockedInAt·실입고량 초기화. 등록된 입고가 있으면 409(재고 위치에서 먼저 조정). 삭제도 같은 규칙(입고 없는 STOCKED_IN 차수는 삭제 허용).
4. 입고 등록 수량: 자체 위치 분배 옵션별 수량이 기본값, **수정 가능**, 0이면 건너뜀. 차수×옵션×위치당 **1회**(중복 방지). 입고일 기본 = 입고 완료 일자.
5. 등록한 옵션·위치는 수량이 분배와 달라도 「입고 예정」을 **전부 해소**(실입고가 기준). 미등록 옵션은 계속 입고 예정.
6. 차수 수정 창에서 상태 「입고 완료」 선택 시 **위치 분배 입력을 창 안에 펼쳐** [수정]으로 한 번에 저장(입고 완료 창과 같은 컴포넌트). 입고 완료 차수는 같은 자리에 분배 결과 + 「사무실 입고 등록」 영역.

## 설계

### 데이터 (마이그레이션 없음)

`ProductionRun.externalStockIns`(Json)에 **모든 분배**(연동 + 자체)를 `{optionId, locationId, quantity}`로 저장한다. 이름은 레거시로 두고 주석으로 의미 변경을 명시한다(컬럼 rename 은 DROP 위험 — 하지 않음). 과거 차수는 자체 분배가 들어 있지 않고 이미 INBOUND 됐으므로 영향 없음.

등록 여부 = `InvMovement` 에 `referenceId = prodrun:<runId>:<optionId>:<locationId>` INBOUND 존재. 과거 자동 입고분도 같은 키라 「등록됨」으로 일관 처리된다.

### 서버

1. `transition/route.ts` STOCKED_IN: `applyBatchInbound` 제거 → 상태·stockedInAt·실입고량·세트 실입고·`externalStockIns = 전체 분배`만 기록. 입력 `ownStockIn?: boolean`(기본 false)이 true 면 같은 트랜잭션에서 자체 위치 분배분 INBOUND(기존 referenceId·사유 문구 그대로). 역행 전환 차단을 규칙 3으로 교체: 행 선점(`updateMany where status='STOCKED_IN'`) 후 같은 tx 에서 `prodrun:<runId>:` INBOUND 존재 확인 → 있으면 롤백 409.
2. 신규 `POST /api/sh/production-runs/[runId]/own-stock-in` `{ movementDate, entries:[{optionId, locationId, quantity}] }`: run STOCKED_IN, 각 entry 가 분배 기록의 자체 위치(비연동·활성)와 일치, quantity>0 정수만, 이미 등록된 키는 409. tx 안에서 차수 행 `FOR UPDATE` 잠금 후 중복 확인 → `applyBatchInbound`. deck write 권한.
3. `[runId]/route.ts` PATCH: STOCKED_IN 직접 전환 경로는 지금처럼 transition 으로 유도(변경 없음). DELETE: 규칙 3과 같은 조건으로 STOCKED_IN 삭제 허용.
4. `production-runs/route.ts` POST(처음부터 STOCKED_IN 생성 경로가 있으면): transition 과 같은 규칙 — 자동 INBOUND 제거, `ownStockIn` 선택.
5. `stock-inputs.ts`: 대기분 대상을 외부 위치 한정 → **전체 분배**로 넓히고, 해소 조건에 「그 키의 INBOUND 존재」 추가(차수 id·옵션·위치로 조회 1회). 로켓 연동분 계산은 그대로.

### 화면

- `production-run-transition-dialog.tsx`: 위치 분배 입력부를 컴포넌트로 분리(`StockInAllocationFields`)하고, 자체 위치가 하나라도 있으면 「사무실 재고에 입고 등록」 체크(기본 해제) + 설명 「체크하면 재고 위치에 [입고] 건이 생깁니다. 나중에 차수에서 등록할 수도 있습니다」.
- `production-run-form-dialog.tsx` 진행 단계: 「상태 변경만…」 안내 제거. 상태 「입고 완료」 선택 시 `StockInAllocationFields` 펼침, [수정] = PATCH(기본 정보) 후 transition 호출(상태 변경이 있을 때). 입고 완료 차수: 분배 결과 표 + 「사무실 입고 등록」(미등록 자체 분배 행·수량 입력·입고일·[입고 등록]) + 등록된 행은 「등록됨」. 「발주 완료로 되돌리기」 버튼(등록 입고 없을 때만 노출).
- 목록 상태 메뉴: 입고 완료 차수에 「발주 완료로 되돌리기」 추가(같은 조건). GET 응답에 `ownStockInRegistered`(등록 키 목록) 포함.

## 변경 파일

- `app/api/sh/production-runs/[runId]/transition/route.ts`, `[runId]/route.ts`, `route.ts`, 신규 `[runId]/own-stock-in/route.ts`
- `src/lib/sh/schemas.ts`(transition `ownStockIn`, own-stock-in 스키마)
- `src/lib/inv/reorder-engine/stock-inputs.ts`
- `src/components/sh/products/production/production-run-transition-dialog.tsx`, `production-run-form-dialog.tsx`, `production-runs-table.tsx`, 신규 `stock-in-allocation-fields.tsx`
- 테스트: transition route(자동 INBOUND 없음, ownStockIn=true 시 자체분만 INBOUND, 되돌리기 허용/409, 동시성), own-stock-in route(정상·중복 409·분배 밖 400·연동 위치 400·수량 0 skip), stock-inputs(자체 분배 대기분·입고 등록 해소·대조 해소·한도), form dialog RTL(입고 완료 선택 시 분배 펼침·되돌리기 노출 조건)

## 검증

- jest 관련 suites, tsc, eslint 변경 파일, `npm run build`
- 운영(배포 후): 테스트 차수 하나로 입고 완료(사무실 분배, 체크 해제) → 재고 변화 없음·발주 미리보기 입고 예정 반영 → 차수에서 사무실 입고 등록 → 재고 위치 입고 내역 1건·입고 예정 해소 → 되돌리기 409 확인. 테스트 데이터는 사용자 확인 후 정리.

## 위험과 롤백

- 사용자가 사무실 입고 등록을 잊으면 사무실 현재고가 실제보다 적음 → 대기 한도 동안 입고 예정으로 발주 과잉은 막고, 사무실 실사 대조로 바로잡는다.
- 되돌리기 후 재입고 완료 시 분배가 다시 기록 — 재고 영향 없음.
- 롤백: 코드 revert. 스키마 변경 없음. 새 흐름으로 만든 INBOUND 는 일반 입고 건이라 그대로 유효.

## Codex 적대 검토 반영 (지적 7건 — 반영 7)

1. [critical] PATCH 우회: `[runId]/route.ts` PATCH 는 **상태 변경을 받지 않는다**(현재 상태와 다르면 400, transition 사용 안내). 모든 상태 전환 = transition 하나. 테스트: PATCH 로 STOCKED_IN→ORDERED 시도 400.
2. [high] 대조 후 입고 등록 이중 계상: own-stock-in 은 그 위치에 stockedInAt 이후 **확정 대조가 있으면 거부**(「대조로 이미 반영됨」), 화면도 그 행을 「대조 반영」으로 표시하고 입력 비활성. 직렬화: own-stock-in tx 에서 대상 위치 행(`InvStorageLocation`) `FOR UPDATE` 후 대조 존재 재확인 → 대조 확정 경로도 같은 위치 행을 먼저 잠그도록 한 줄 추가(이미 잠그면 확인만). 테스트: 대조 선행 시 409.
3. [high] 과거 차수 되돌리기: 되돌리기·삭제 허용 조건 = ① 분배 기록(`externalStockIns`)이 비어 있지 않음(재고 없이 STOCKED_IN 된 레거시 9건 등은 차단), ② 그 차수 INBOUND(`prodrun:<runId>:`) 없음, ③ 분배한 어느 위치에도 stockedInAt 이후 확정 대조 없음. 하나라도 아니면 409 + 사유. 배포 전 운영 읽기 조사: STOCKED_IN 차수 중 조건 통과 건수·목록을 보고(되돌리기 가능해지는 과거 차수 확인).
4. [high] 코드 revert 시 미등록 자체 분배 누락: 롤백 절차에 「revert 전 미등록 자체 분배 목록 조회 → 사용자 확인 후 사무실 입고 등록 또는 대조」를 명시. 2단계 배포는 하지 않음(사용 빈도 낮고 대기 한도 내 수동 처리 가능 — 이유).
5. [high] 요청 내 중복 키: own-stock-in·transition(ownStockIn) 모두 같은 optionId·locationId 중복 entry 400. 테스트 추가.
6. [high] 현재고·입고 예정 스냅샷 불일치: `stock-inputs.ts` 의 재고 수준·차수·INBOUND·대조 읽기를 `prisma.$transaction([...], { isolationLevel: RepeatableRead })` 배열 트랜잭션으로 묶어 같은 스냅샷에서 읽는다. 테스트: 단위(모킹)로 호출 형태 고정, 통합 경합 테스트는 범위 밖(이유: 읽기 전용 일시 오차, 다음 계산에서 자연 해소) — 보류 아님, 스냅샷 묶음으로 해소.
7. [medium] 수정 창 두 요청: 입고완료 선택 시 저장 = PATCH(기본 정보·옵션) → transition. transition 실패 시 창을 닫지 않고 「기본 정보는 저장됐고 입고 완료는 처리되지 않았습니다: <사유>」 표시, 재시도는 transition 만 다시 호출(PATCH 재전송 안 함). 입고완료 선택 중에는 옵션 추가·삭제·수량 편집을 잠가 분배 입력과 어긋나지 않게 한다.
