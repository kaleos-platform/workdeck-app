# 쿠팡 판매분석 → seller-ops 연동 운영 런북

브랜드 운영(seller-ops)이 쿠팡 로켓그로스 판매/재고를 발주예측·재고에 쓰도록 하는 파이프라인 운영 가이드.

## 데이터 흐름

```
워커(PM2, 매일 node-cron)
  ├─ inventory_health 수집 → InventoryRecord(재고 truth)
  └─ 판매분석 VENDOR 1일 수집 → InventoryRecord(VENDOR_ITEM_METRICS)
       ↓ (수집 직후 워커가 x-worker-api-key 로 체이닝)
  ├─ POST/GET /api/cron/coupang-inventory-sync → 재고 대조(절대값 set) → InvStockLevel
  └─ GET /api/cron/coupang-sales-sync → 로켓 판매를 dated OUTBOUND(stock-neutral) → 발주예측 history
```

- 재고 truth = inventory_health 대조. OUTBOUND = 발주예측 수요 신호(재고 미차감).
- 판매자배송은 제외(이미 DelBatch→OUTBOUND).

## (a) ⛔ 운영 투입 전 #1 게이트 — 워커 날짜필터 셀렉터 QA

`worker/src/inventory-collector.ts`의 `downloadSalesAnalysisVendor`는 Wing 판매분석에서 **기간=1일**로 export해야 한다. 날짜 picker 셀렉터가 `// TODO: 실제 DOM 확인 필요`로 추정값이다. **셀렉터가 조용히 실패하면 Wing 기본값(최근 7일)으로 export → 매일 ~7배 수량이 OUTBOUND로 기록 → 발주 7배 과대.** VENDOR엔 날짜 컬럼이 없어 in-file 탐지 불가, referenceId 멱등으로도 못 잡음.

### QA 절차 (워커 호스트에서, 쿠팡 크레덴셜 필요)

1. 워커 호스트에서 headful로 실행:
   ```bash
   cd worker && HEADLESS=false npx tsx src/backfill-sales-vendor.ts 1
   ```
   (또는 Playwright inspector: `PWDEBUG=1`)
2. `https://wing.coupang.com/tenants/business-insight/sales-analysis` 진입 후 **기간이 실제 하루로 설정**되는지 눈으로 확인. `.screenshots/sales-analysis-*.png` 확인.
3. 다운로드된 파일 `판매량` 합계가 그 하루의 KPI와 일치하는지 대조 (Wing 화면 "판매량" 카드 vs 파일 합).
4. 일치하면 게이트 통과. 불일치(7일치 등)면 `downloadSalesAnalysisVendor`의 날짜 picker 셀렉터를 실제 DOM에 맞게 수정.

### 선택적 런타임 방어 (미구현)

DAILY_SUMMARY_METRICS(일별 전체합)도 수집해 `sum(VENDOR 판매량) ≈ DAILY[date].판매량` 교차검증 후 OUTBOUND 기록. 셀렉터 드리프트 자동 감지. 현재 미구현 — 셀렉터 신뢰가 1차 방어.

## (b) CRON_SECRET — 선택적 백스톱

두 sync는 **워커 체이닝(x-worker-api-key)이 1차 경로**라 CRON_SECRET 없이 동작한다. Vercel cron 엔트리(vercel.json)는 워커 다운 시 백스톱이며, **CRON_SECRET 설정 시에만 동작**한다.

### 백스톱 활성화하려면 (선택)

```bash
# 강력한 랜덤 시크릿 생성 후 prod+preview 설정
openssl rand -hex 32
vercel env add CRON_SECRET production --scope <scope>
vercel env add CRON_SECRET preview --scope <scope>
# 재배포 후 적용
```

### ⚠️ 별개 이슈 — 기존 Vercel cron dead

`reorder-settle`, `inventory-stale-check`는 CRON_SECRET 부재로 **한 번도 실행된 적 없음**(stale-skip 마커 0, cron heartbeat 없음으로 확인). CRON_SECRET 설정 시 이들도 살아난다. 본 연동과 별개지만 운영팀 판단 필요.

## 콜드스타트 백필 (신규 로켓그로스 도입 시)

발주예측이 90일 zero-fill로 과소예측하지 않도록 과거 판매를 시딩:

```bash
# 1) VENDOR 적재 (워커 호스트)
cd worker && npm run backfill-sales 90
# 2) OUTBOUND 변환 (CRON_SECRET 설정된 경우; 아니면 워커가 다음 수집 시 어제분만 변환)
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$WORKDECK_APP_URL/api/cron/coupang-sales-sync?from=2026-03-06&to=2026-06-03"
```

백필 OUTBOUND는 stock-neutral(과거 판매는 이미 현재 재고에 반영됨).

## 전제 조건 (Space별)

- 쿠팡 로켓그로스 위치: `InvStorageLocation.externalSource='coupang_rocket_growth'` + `externalIntegrationKey=<workspaceId>` (수동 연동 시 backfill됨).
- `InvLocationProductMap`: 쿠팡 externalCode(skuId/optionId/productId) → 옵션 매핑.
- 쿠팡 판매채널: 이름에 "쿠팡" 포함 + isSalesChannel (OUTBOUND 귀속용).
- coupang-ads DeckInstance 활성.
