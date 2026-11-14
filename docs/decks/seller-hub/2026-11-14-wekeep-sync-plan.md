# 위킵 재고 연동 + N배송 바코드 매칭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 위킵(3PL) 재고를 재고 조정 「데이터 연동」 버튼으로 필요할 때 가져와 대조하고, 위치별로 켜면 주 1회 자동 조정한다. N배송 주문의 바코드로 옵션을 매칭할 수 있게 해 미차감을 없앤다.

**Architecture:** 서버가 위치에 연결된 LOGIN 비밀값으로 위킵에 HTTP 로그인 → 재고 JSON API 조회 → 기존 대조 파이프라인(`runReconciliationMatch`)에 `inventory_list`와 같은 규칙의 행으로 투입. 주간 cron은 같은 소스로 대조를 만들고 가드 통과 시 `confirmReconciliation`. N배송은 주문 항목의 `skuMappings`(nsBarcode)를 화면에 노출하고 바코드별 옵션 매칭을 `bc:<barcode>` alias로 저장.

**Tech Stack:** Next.js 16, Prisma 7, Jest, shadcn/ui.

**Spec (2026-11-14 grill 확정):**

1. 입출고 관리가 주문 차감을 하므로 위킵 전체 대조는 필요할 때만 — 재고 조정 「데이터 연동」에 위킵 추가(미리보기 → 사용자 확정).
2. 수집은 워크덱 서버가 직접 HTTP로(브라우저 없음). 클라우드 IP 차단이 확인되면 워커로 전환(이번 범위 밖).
3. 계정 연결은 위치 관리에서 3PL 위치별로: 「외부 연동: 위킵」 + LOGIN 비밀값 선택.
4. 위치별 「주간 자동 조정」 토글(기본 꺼짐). 매주 월요일 09:00 KST 자동 확정. 단 큰 차이(옵션 하나라도 |차이| > 50, 차이 옵션 > 10건, 미매칭 재고 행 존재) 는 확정하지 않고 미확정 + Slack 알림.
5. N배송 미매칭은 바코드 기반 매칭으로 해결(내가 매칭안 → 사용자 승인 → 저장).

**위킵 API (실측 2026-11-14):**

- 로그인: `POST https://fbw.wekeep.co.kr/fbw/j_spring_security_check` (form urlencoded `j_username`, `j_password`, `_spring_security_remember_me=on`) → 세션 쿠키(JSESSIONID). 실패 시 로그인 페이지로 리다이렉트.
- 재고: `POST https://fbw.wekeep.co.kr/fbw/admin/v2/inventory/search?searchInventoryType=INVENTORY` JSON `{ "page": 1, "pageSize": 30 }` → `{ result: true, data: { inventoryCnt, inventoryList: [{ skuNo, productName, variationValue, productManageCode, availableQty, safeQty, reserveQty, faultyQty, damageQty, ... }] } }`. 페이지 반복(inventoryCnt까지).
- `skuNo` = 엑셀 「SKU번호」 = 기존 대조 매핑의 externalCode. 판매가능 = availableQty + reserveQty, 하자 = faultyQty + damageQty.

## Global Constraints

- 스키마 변경은 마이그레이션 파일만(`prisma migrate diff --from-schema <HEAD 스키마> --to-schema prisma/schema.prisma --script` → 새 미래 날짜 폴더 → `migrate deploy`; DROP 금지).
- 비밀번호는 로그·응답·감사·에러 메시지에 절대 싣지 않는다. 위킵 오류 메시지는 고정 한국어 문구로 치환.
- 외부 물류 위치 판정은 `src/lib/inv/location-kind.ts`의 `isExternalLogisticsLocation`.
- 대조 행 규칙은 `src/lib/inv/reconciliation-parser.ts` `parseInventoryList`와 동일(quantity=가용+유보, defectQuantity=하자).
- UI는 DESIGN.md + workdeck-ui. 문구 한국어.
- 커밋 `<emoji> <type>(sh): <요약>` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. 위킵 로그인 실패·세션 만료·HTML 응답(로그인 페이지로 튕김) → 고정 문구 에러, 비밀번호 미노출.
2. 위킵 SKU가 매핑 안 된 행 → 미리보기 file-only(기존 흐름)·자동 조정은 보류.
3. 주간 cron에서 같은 위치에 이전 자동 미확정이 남아 있을 때 → 이전 것 취소 후 새 것 1건만.
4. N배송 다중 바코드 주문(2장 세트=바코드 2개) → 바코드별 alias 저장, 재동기화로 과거 주문까지 차감.
5. 비밀값이 삭제·LOGIN 아님·다른 Space 것 → 연동 거부.

---

### Task 1: N배송 바코드 노출 + 바코드별 매칭

**Files:** `app/api/sh/shipping/batches/[batchId]/orders/route.ts`(항목에 `skuMappings` 포함), `app/api/sh/shipping/orders/[orderId]/items/[itemId]/match/route.ts`(다중 바코드 지원), 주문 항목 매칭 UI(`grep -rn "items/.*match" src/components`로 찾기), 테스트.

- 응답 항목에 `skuMappings: Array<{ nsBarcode: string; pickingQuantityPerOrder: number }> | null`.
- match PATCH 본문에 `barcodeOptions?: Array<{ nsBarcode: string; optionId: string }>` 추가: N배송(NAVER_API) 항목이고 skuMappings의 모든 바코드에 옵션이 지정되면 바코드마다 `bc:<barcode>` alias(fulfillment = 그 옵션 × 1)를 upsert, 항목 fulfillments = Σ(remainQuantity × picking) 기준으로 갱신, 기존과 같이 스토어 커서 null(재동기화). 단일 바코드 기존 동작 유지.
- UI: N배송 항목에 바코드가 있으면 바코드별 행 + 옵션 선택.
- 테스트: 2바코드 주문 → alias 2개·fulfillment 2행; 바코드 일부만 지정 → 400; 단일 바코드 기존 테스트 유지.

### Task 2: 위킵 클라이언트 + 서버용 비밀값 로더

**Files:** Create `src/lib/inv/wekeep-client.ts`, test; Modify `src/lib/agent/secrets/store.ts`(+test).

- `fetchWekeepInventory(cred: { username: string; password: string }, fetchImpl = fetch): Promise<WekeepInventoryRow[]>`; `WekeepInventoryRow = { skuNo: string; productName: string; available: number; reserve: number; faulty: number; damage: number }`. 로그인 → 쿠키 유지 → 페이지 반복(pageSize 100). 에러는 `WekeepError(code: 'LOGIN_FAILED'|'BLOCKED'|'UNEXPECTED')` + 고정 한국어 메시지.
- `loadLoginSecretForSystem(spaceId: string, name: string): Promise<{ id; loginUrl; username; password }>` — kind LOGIN만, 없으면 throw, `recordSecretUsed`. 에이전트 허용목록 무관(서버 내부 전용, 위치에 연결된 이름만 호출).
- 테스트(fetch mock): 정상 2페이지, 로그인 실패(로그인 페이지 HTML), JSON result false, 비밀번호가 에러 메시지에 없음.

### Task 3: 위치 연동 설정 (스키마 + API + 위치 관리 UI)

**Files:** `prisma/schema.prisma` InvStorageLocation + migration, `app/api/sh/inventory/locations/[locationId]/route.ts`, `app/api/sh/inventory/locations/route.ts`(목록에 필드), `src/components/sh/inventory/location-manager.tsx`, tests.

- 컬럼: `syncProvider String?`('wekeep'), `syncSecretName String?`, `autoReconcileWeekly Boolean @default(false)`.
- PATCH 검증: syncProvider ∈ {'wekeep', null}; 설정 시 위치가 외부 물류(3PL)여야 함; syncSecretName은 같은 Space의 LOGIN 비밀값이어야 함; autoReconcileWeekly는 syncProvider 있을 때만 true 가능.
- UI: 3PL 위치 편집에 「외부 연동」(없음/위킵), 「로그인 비밀값」(LOGIN 비밀값 목록 select, 비밀값 API 재사용), 「주간 자동 조정(매주 월 09시)」 스위치 + 설명.

### Task 4: 재고 조정 「데이터 연동」 위킵 소스

**Files:** `src/lib/inv/reconciliation-sources.ts`(`getWekeepInventoryRows`), `app/api/sh/inventory/reconciliation/route.ts`(`source: 'wekeep', locationId`), `src/components/sh/inventory/reconciliation-upload.tsx`(데이터 연동 다이얼로그에 위킵 연동 위치들), tests.

- `getWekeepInventoryRows(spaceId, locationId): Promise<ParseResult>` — 위치의 syncSecretName으로 로그인 → 행 변환(format 'inventory_list', externalCode=skuNo, quantity=available+reserve, defectQuantity=faulty+damage(>0일 때), externalName=productName).
- 라우트: 위치가 syncProvider='wekeep'인지 확인 → 기존 runReconciliationMatch(PENDING) → 응답은 쿠팡 연동과 동일 형태. fileName `위킵 재고 (연동 YYYY-MM-DD HH:mm KST)`.
- WekeepError → 400/502 고정 문구.

### Task 5: 주간 자동 조정 cron

**Files:** Create `app/api/cron/wekeep-weekly-reconcile/route.ts` + test, `vercel.json` cron `0 0 * * 1`.

- `withCronRun`(cron-secret). 대상 = `syncProvider='wekeep' AND autoReconcileWeekly AND isActive` 위치.
- 위치별: 이전 자동 PENDING(파일명 접두 `위킵 재고 (자동 `)을 CANCELLED → 새 대조(파일명 `위킵 재고 (자동 YYYY-MM-DD)`) 생성 → 가드: matched-diff 옵션 중 |차이|>50 하나라도, matched-diff 옵션 수>10, file-only 중 quantity>0 행 존재 → 보류(PENDING 유지) + `sendSpaceNotification` 알림(차이 건수·이유·재고 조정 링크). 통과 시 `confirmReconciliation` + 요약 알림(조정 N건).
- 위치별 실패(로그인 실패 등)는 다른 위치에 영향 없이 기록 + 알림.
- 테스트: 가드 통과→confirm 호출, 큰 차이→confirm 미호출+알림, 로그인 실패→알림, 이전 자동 PENDING 취소.
