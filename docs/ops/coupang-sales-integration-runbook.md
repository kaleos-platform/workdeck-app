# 쿠팡 판매분석 → seller-ops 연동 운영 런북

브랜드 운영(seller-ops)이 쿠팡 로켓그로스 판매/재고를 발주예측·재고에 쓰도록 하는 파이프라인 운영 가이드.

## 데이터 흐름

```
워커(PM2, 매일 node-cron)
  ├─ inventory_health 수집 → InventoryRecord (수동 대조 소스로 보관)
  └─ 판매분석 VENDOR 1일 수집 → InventoryRecord(VENDOR_ITEM_METRICS)  ※ 토글로 끌 수 있음
       ↓ (수집 직후 워커가 x-worker-api-key 로 체이닝)
  └─ GET /api/cron/coupang-sales-sync → 로켓 판매를 dated OUTBOUND(**재고 차감**) → 발주예측 + 재고 원장
```

- **재고 truth = OUTBOUND 차감 + 사용자 수동 대조 보정.** 자동 대조 cron 은 제거됨.
- 쿠팡 FC 입고(보충)는 워커가 수집하지 않으므로 재고가 하향 drift → 사용자가 수동
  재고이동(INBOUND) 또는 수동 대조(절대값 set)로 보충. (수동 대조는 데이터 연동 버튼 그대로.)
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
