# 쿠팡 판매분석 → seller-ops 연동 운영 런북

브랜드 운영(seller-ops)이 쿠팡 로켓그로스 판매/재고를 발주예측·재고에 쓰도록 하는 파이프라인 운영 가이드.

## 데이터 흐름

```
워커(PM2, 매일 node-cron)
  ├─ inventory_health 수집 → InventoryRecord (자동/수동 대조 소스)
  └─ 판매분석 VENDOR 1일 수집 → InventoryRecord(VENDOR_ITEM_METRICS)  ※ 토글로 끌 수 있음
       ↓ (수집 직후 워커가 x-worker-api-key 로 체이닝 — 순서 고정)
  ├─ ① GET /api/cron/coupang-sales-sync      → 로켓 판매를 dated OUTBOUND(재고 차감) → 발주예측 + 재고 원장
  └─ ② GET /api/cron/coupang-inventory-sync  → 최신 스냅샷으로 자동 대조(절대량 set) → 재고 정합
```

- **재고 truth = inventory_health 스냅샷(실측).** OUTBOUND 차감은 스냅샷 사이를 메우는 보간이다.
- **①→② 순서가 정확성에 직결된다.** 스냅샷은 수집 시점 Wing 실재고라 어제 판매가 이미
  반영돼 있다. 절대량 set 인 대조를 ① 앞에 적용하면 그 뒤 OUTBOUND 가 한 번 더 빠져 이중 차감.
- 쿠팡 FC 입고(보충)는 워커가 수집하지 않아 원장만 보면 재고가 하향 drift 하지만, ② 자동 대조가
  매일 스냅샷 절대값으로 되돌린다. (수동 '데이터 연동' 버튼도 그대로 동작.)

### ② 자동 대조 반영 정책

| 행 상태 | 처리 |
| --- | --- |
| matched-diff | 자동 반영 (ADJUSTMENT, 절대량 set) |
| matched-equal | 무시 |
| file-only (미매핑 외부 SKU) | 자동 반영 불가 → PARTIAL 유지 + Slack 알림. 매핑하면 다음 회차부터 자동 |
| system-only (스냅샷에 없는 위치 재고) | **조건부 0 처리** — ① file-only 0건이고 ② 그 옵션에 외부 SKU 매핑이 있을 때만 |

**매핑 없는 system-only = "쿠팡 SKU 연결 필요"**. 외부 코드가 없으니 file-only 짝도 안 생겨
file-only 0건 검사로 걸러지지 않는다. 소진인지 미연동인지 구별 불가 → 재고를 건드리지 않고
대조를 PARTIAL 로 남긴다. 재고 조정 화면의 `파일 누락` 필터에 **매핑 필요** 배지 + `쿠팡 SKU 연결`
버튼이 뜨고, 상단 안내 배너와 Slack 으로도 알린다. 연결하면 다음 회차부터 자동 반영.
쿠팡에 없는 상품이면 연결하지 말고 재고 이동으로 다른 위치로 옮기면 된다.

안전장치 — 걸리면 **재고를 건드리지 않고 스킵 + Slack**:

1. **스냅샷 완전성**: 최근 10건 업로드 `insertedRows` MAX 의 50% 미만이면 부분 export 의심 → 대조 생성 안 함
2. **대량 변동**: 변동 옵션이 10건 이상이면서 30% 초과, 또는 system-only 가 10건 이상이면서 20% 초과
   → 대조는 PENDING 으로 남겨 사람이 확인. (절대 건수 조건이 없으면 SKU 가 적은 셀러는 정상
   변동에도 매일 걸려 자동 대조가 영영 안 돈다 — 소규모 부분 export 는 완전성 가드가 잡는다)
3. **멱등**: 같은 `(spaceId, locationId, snapshotDate)` 가 이미 처리됐으면 skip
   (`InvReconciliation` 에 unique 제약이 없고, 재적용 가드는 같은 `reconciliationId` 안에서만 동작한다.
   새 레코드로 다시 confirm 하면 `referenceId` 가 달라져 그 사이 INBOUND/OUTBOUND 가 덮어써진다)
   가드에 걸려 남긴 PENDING 도 같은 스냅샷이면 재생성하지 않는다(`skip:pending-review`) — 안 그러면 매일 쌓인다

summary status 읽는 법: `ok` / `skip:already-applied`(정상 재실행) / `skip:pending-review`(사람 확인 대기)
/ `skip:no-snapshot` / `skip:incomplete-snapshot` / `skip:large-delta` / `skip:deck-inactive` / `skip:no-workspace-link` / `error`

**알림 dedupe 없음** — 미매핑 SKU 를 방치하면 매일 알림이 온다. 알림이 반복되면 원인을 없애는 게 정답이다.

`vercel.json` crons 에 등록하지 않는다 — 워커가 수집에 성공했을 때만 도는 게 맞다.
**도입 첫 실행은 누적 drift 때문에 대량 변동 가드에 걸리는 게 정상**이다. 운영자가 UI 에서
수동 대조 1회로 baseline 을 맞춘 뒤부터 자동 반영이 정착한다.

되돌리려면 `worker/src/orchestrator.ts` 의 `triggerInventoryReconciliation()` 호출 1줄만 제거하면
된다. 잘못 반영된 재고는 `InvMovement.referenceId = <reconciliationId>` 로 추적한다.
- 판매자배송은 제외(이미 DelBatch→OUTBOUND). 로켓 채널은 위치와 동일 externalSource 1:1 페어링.
- VENDOR 매출(₩)·수량은 채널별 매출 현황의 로켓 채널 행에 합산(주문수 없음 → 수량 표기).

## (a) 워커 날짜필터 셀렉터 — 2026-06 live Wing 검증 완료

`worker/src/inventory-collector.ts`의 `selectSalesAnalysisOneDay`가 Wing 판매분석 기간을 **1일**로 지정한다. 기간 컨트롤은 **@vuepic/vue-datepicker**다(이전 코드의 input-fill 방식은 완전히 틀렸어서 교체함). 2026-06-06 live DOM 에서 검증한 셀렉터:

| 요소            | 셀렉터                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| 기간 트리거     | `._toolbar_ejsky_5 span`(텍스트 가변: "최근 7일"/날짜)                 |
| 날짜 셀         | `[data-test-id="dp-YYYY-MM-DD"]`(시작=종료 2회 클릭 = 1일)             |
| 이전 달         | `[class*="_prev_"]`                                                    |
| 프리셋          | 오늘/어제/최근 N일 버튼(`_button_fs0ho_1`) — 어제 1일에 대안 사용 가능 |
| 상품별 다운로드 | `text=상품별 엑셀 다운로드`(메뉴: 기간별/상품별 2종 확인)              |

**여전히 중요**: 셀렉터가 조용히 실패하면 기본값(최근 7일)으로 export → 7배 과발주. VENDOR엔 날짜 컬럼 없어 in-file 탐지 불가. DOM 변경 시 위 셀렉터 갱신. 함수는 셀/트리거 미발견 시 screenshot 남기고 **throw**(조용한 7일 export 차단).

### 재검증 절차 (DOM 변경 의심 시)

```bash
cd worker && HEADLESS=false npx tsx src/backfill-sales-vendor.ts 1
```

→ Wing 화면 기간이 1일로 설정되는지 + 파일 `판매량` 합 = 그 하루 KPI 일치 확인. `.screenshots/` 참고.

### 선택적 런타임 방어 (미구현)

DAILY_SUMMARY("기간별 엑셀 다운로드")도 수집해 `sum(VENDOR 판매량) ≈ DAILY[date].판매량` 교차검증 후 OUTBOUND 기록 → 셀렉터 드리프트 자동 감지. 현재 미구현 — 셀렉터 신뢰가 1차 방어.

## (b) 인증 — 워커 키 전용 (CRON_SECRET 제거됨)

sales-sync 는 **워커 체이닝(x-worker-api-key) 전용**이다. 본 연동의 Vercel cron 엔트리·CRON_SECRET 백스톱은 제거됐다(워커 heartbeat 모니터링이 다운을 감지). 워커가 다운되면 데이터가 멈추지만 잘못된 데이터는 안 들어간다.

### ⚠️ 별개 이슈 — 기존 Vercel cron

`reorder-settle`, `inventory-stale-check`는 여전히 CRON_SECRET 에 의존한다(별개 prod 이슈, 본 연동과 무관 — 건드리지 않음).

## 콜드스타트 백필 (신규 로켓그로스 도입 시)

발주예측이 90일 zero-fill로 과소예측하지 않도록 과거 판매를 시딩. **데이터 연동 화면에서
판매 데이터가 없을 때 팝업이 떠 사용자가 일수를 정해 실행**한다(웹 → CoupangBackfillJob 생성 →
워커 폴링이 VENDOR 수집 후 sales-sync range 변환까지 자동 체이닝).

수동(CLI) 대안:

```bash
cd worker && npm run backfill-sales 90   # VENDOR 적재 후 자동으로 변환 체이닝 안내
```

백필 OUTBOUND 도 재고를 차감한다. 신규 로켓 위치는 보통 기준재고 0 → 과거 판매가 음수 재고를
만들 수 있고, 사용자가 수동 재고이동(INBOUND)/대조로 기준재고를 맞춘다.

## 전제 조건 (Space별)

- 쿠팡 로켓그로스 위치: `InvStorageLocation.externalSource='coupang_rocket_growth'` + `externalIntegrationKey=<workspaceId>` (수동 연동 시 backfill됨).
- `InvLocationProductMap`: 쿠팡 externalCode(skuId/optionId/productId) → 옵션 매핑.
- 쿠팡 로켓 판매채널: `Channel.externalSource='coupang_rocket_growth'` (OUTBOUND 귀속용). 위치·채널 어느 쪽 연동 시에도 다른 쪽 자동 페어링(1:1). `findFirst({name contains '쿠팡'})` 비결정 lookup 제거됨.
- coupang-ads DeckInstance 활성.
