/**
 * Phase 0 — 쿠팡 Open API 실측 대조 스크립트
 *
 * 앱에서 API 자격 + 최신 크롤링(INVENTORY_HEALTH) 스냅샷 요약을 가져와, 4종 API를
 * 각각 호출해 원본 응답을 worker/tmp/api-verify/<scope>-<날짜>.json 에 덤프하고
 * 재고에 대해 대조표(행 수, externalSkuId 매칭률, 수량 합계)를 콘솔에 출력한다.
 *
 * 게이트: 이 리포트에서 externalSkuId 매칭률과 수량 일치가 확인되기 전에는
 * CoupangSourceSetting.inventorySource = API 를 프로덕션에서 켜지 않는다.
 *
 * 실행: npm run api-verify (worker/ 에서, .env 에 WORKDECK_API_URL/WORKER_API_KEY 필요)
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { getApiCredential, getApiVerifyBaseline } from '../api-client.js'
import { decrypt } from '../encryption.js'
import { CoupangApiClient, CoupangApiError } from './client.js'
import {
  extractInventoryQuantities,
  fetchInventorySummaries,
  fetchRgOrders,
  fetchRevenueHistory,
  fetchSettlementHistories,
  fetchSellerProducts,
} from './endpoints.js'

const DUMP_DIR = path.resolve('tmp/api-verify')
const today = new Date().toISOString().slice(0, 10)

function dump(scope: string, data: unknown): string {
  if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR, { recursive: true })
  const file = path.join(DUMP_DIR, `${scope}-${today}.json`)
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  return file
}

function kstDate(offsetDays: number): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  kst.setDate(kst.getDate() + offsetDays)
  return kst.toISOString().slice(0, 10)
}

async function main(): Promise<void> {
  console.log('=== Phase 0 — 쿠팡 Open API 실측 대조 ===\n')

  // ── 1. 자격 + 크롤링 베이스라인 조회 ──
  const cred = await getApiCredential()
  if (!cred || !cred.isActive) {
    console.error(
      '쿠팡 API 자격증명이 없거나 비활성 상태입니다. /settings/integrations 에서 먼저 등록하세요.'
    )
    process.exit(1)
  }
  const secretKey =
    cred.encryptionIv === 'none' ? cred.secretKey : decrypt(cred.secretKey, cred.encryptionIv)
  const client = new CoupangApiClient({
    vendorId: cred.vendorId,
    accessKey: cred.accessKey,
    secretKey,
  })

  let baseline: Awaited<ReturnType<typeof getApiVerifyBaseline>> | null = null
  try {
    baseline = await getApiVerifyBaseline()
  } catch (err) {
    console.warn('크롤링 베이스라인 조회 실패 — 대조표 없이 진행:', err)
  }

  // ── 2. 재고(로켓창고) — 확인된 API, 대조표 출력 ──
  console.log('\n[1/4] 재고(로켓창고) 요약 조회...')
  try {
    const summaries = await fetchInventorySummaries(client, cred.vendorId)
    const file = dump('inventory', summaries)
    console.log(`  → ${summaries.length}건, 덤프: ${file}`)

    if (baseline) {
      // externalSkuId 는 API 응답에서 숫자로 온다 — 크롤링 baseline(skuIds: string[])과
      // 비교하려면 문자열 정규화가 필수(Phase0 실측 §4).
      const apiSkuIds = new Set(
        summaries
          .map((s) => (s.externalSkuId != null ? String(s.externalSkuId) : null))
          .filter((v): v is string => !!v)
      )
      const baselineSkuIds = new Set(baseline.skuIds)
      const matched = [...apiSkuIds].filter((id) => baselineSkuIds.has(id))
      const apiQtySum = summaries.reduce(
        (sum, s) => sum + (extractInventoryQuantities(s).orderableQuantity ?? 0),
        0
      )

      console.log('\n  ── 재고 대조표 ──')
      console.log(`  행 수:            API ${summaries.length}건 vs 크롤링 ${baseline.rowCount}건`)
      console.log(
        `  externalSkuId 매칭률: ${matched.length}/${apiSkuIds.size} (API 기준) — 크롤링 optionId 종류 ${baseline.optionIdCount}개`
      )
      console.log(
        `  가용재고 합계:      API ${apiQtySum} vs 크롤링 ${baseline.totalOrderableQuantity}`
      )
      console.log(
        '  크롤링에만 있는 필드(보관일수·입고예정·판매불가재고·상품명) — API 응답엔 없음. ' +
          '다운스트림 사용처는 src/lib/sh/* grep 결과를 리포트에 별도 첨부할 것(계획서 §Phase0-3).'
      )
    } else {
      console.log('  (베이스라인 없음 — 대조표 생략)')
    }
  } catch (err) {
    logApiFailure('재고(로켓창고)', err)
  }

  // ── 3. 로켓그로스 주문 목록 — 최근 7일(30일 제한 내 안전 범위) ──
  console.log('\n[2/4] 로켓그로스 주문 목록 조회 (최근 7일)...')
  try {
    const paidDateTo = kstDate(-1).replace(/-/g, '')
    const paidDateFrom = kstDate(-7).replace(/-/g, '')
    const orders = await fetchRgOrders(client, cred.vendorId, paidDateFrom, paidDateTo)
    const file = dump('orders', orders)
    console.log(`  → ${orders.length}건, 덤프: ${file}`)
    console.log(
      `  기간 파라미터 제약: paidDateFrom/To 최대 30일 범위, yyyymmdd 포맷. 분당 50회 제한.`
    )
  } catch (err) {
    logApiFailure('로켓그로스 주문 목록', err)
  }

  // ── 4. 정산 매출내역 — 최근 31일(제한 최대치) ──
  console.log('\n[3/4] 정산 매출내역 조회 (최근 31일)...')
  try {
    const recognitionDateTo = kstDate(-1)
    const recognitionDateFrom = kstDate(-31)
    const revenue = await fetchRevenueHistory(
      client,
      cred.vendorId,
      recognitionDateFrom,
      recognitionDateTo
    )
    const file = dump('revenue-history', revenue)
    console.log(`  → ${revenue.length}건, 덤프: ${file}`)
    console.log('  기간 파라미터 제약: recognitionDateFrom/To 최대 31일, YYYY-MM-dd 포맷.')
  } catch (err) {
    logApiFailure('정산 매출내역', err)
  }

  // ── 5. 정산 지급내역 — 이번 달 ──
  console.log('\n[4/4] 정산 지급내역 조회 (이번 달)...')
  try {
    const yearMonth = kstDate(0).slice(0, 7)
    const settlements = await fetchSettlementHistories(client, yearMonth)
    const file = dump('settlement-histories', settlements)
    console.log(`  → ${settlements.length}건, 덤프: ${file}`)
    console.log(
      '  기간 파라미터 제약: revenueRecognitionYearMonth(YYYY-MM) 단위, 페이징 없음(월 단건).'
    )
  } catch (err) {
    logApiFailure('정산 지급내역', err)
  }

  // ── 6. 상품 목록(로켓그로스 필터) ──
  console.log('\n[+] 상품 목록 조회 (businessTypes=rocketGrowth)...')
  try {
    const products = await fetchSellerProducts(client, cred.vendorId, {
      businessTypes: 'rocketGrowth',
    })
    const file = dump('products', products)
    console.log(`  → ${products.length}건, 덤프: ${file}`)
  } catch (err) {
    logApiFailure('상품 목록', err)
  }

  console.log('\n=== 완료 — 덤프 위치:', DUMP_DIR, '===')
}

function logApiFailure(label: string, err: unknown): void {
  if (err instanceof CoupangApiError && err.reason === 'IP_REJECTED') {
    console.error(`  ✗ ${label} 실패 — IP allowlist 미등록으로 거부됨. Wing에 워커 IP 등록 필요.`)
  } else {
    console.error(`  ✗ ${label} 실패:`, err instanceof Error ? err.message : err)
  }
}

main().catch((err) => {
  console.error('api-verify 실행 실패:', err)
  process.exit(1)
})
