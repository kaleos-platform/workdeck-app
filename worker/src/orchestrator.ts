/**
 * 수집 오케스트레이터
 * API 호출, 자격증명 복호화, Playwright 수집, 업로드까지 전체 파이프라인을 관리한다.
 */
import fs from 'node:fs'
import * as XLSX from 'xlsx'
import {
  createCollectionRun,
  updateCollectionRun,
  getCredentials,
  uploadReport,
  uploadInventory,
} from './api-client.js'
import { decrypt } from './encryption.js'
import { collectCoupangReport } from './collector.js'
import { collectInventoryData } from './inventory-collector.js'
import {
  notifyCollectionDone,
  notifyCollectionFailed,
  notifyInventoryDone,
  notifyVendorSalesDone,
} from './slack-notifier.js'

/**
 * 다운로드된 Excel 파일의 날짜 범위를 검증한다.
 * 파일 내 실제 날짜 중 요청한 종료일(dateTo)이 포함되지 않으면 경고를 로깅한다.
 * 쿠팡이 캐시된 보고서를 반환하거나 최신 날짜 데이터가 누락된 경우를 감지한다.
 */
function verifyDownloadedFile(buffer: Buffer, fileName: string, dateTo: string): void {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false })

    // 날짜 컬럼에서 고유 날짜 추출
    const uniqueDates = new Set<string>()
    for (const row of rows) {
      const raw = String(row['날짜'] ?? '').trim()
      if (raw.length === 8) {
        const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        uniqueDates.add(formatted)
      }
    }

    const sortedDates = [...uniqueDates].sort()
    const fileMinDate = sortedDates[0] ?? '?'
    const fileMaxDate = sortedDates[sortedDates.length - 1] ?? '?'
    console.log(
      `파일 검증: ${fileName} — 날짜 범위 ${fileMinDate} ~ ${fileMaxDate} (${rows.length}행, ${sortedDates.length}일)`
    )

    if (!uniqueDates.has(dateTo)) {
      throw new Error(
        `요청한 종료일(${dateTo})이 파일에 없습니다. ` +
          `파일 날짜: ${sortedDates.join(', ')}. ` +
          `쿠팡이 캐시된 보고서를 반환했을 수 있습니다.`
      )
    }
  } catch (err) {
    // 날짜 불일치 에러는 그대로 전파
    if (err instanceof Error && err.message.includes('요청한 종료일')) throw err
    console.warn('파일 검증 중 오류 (계속 진행):', err instanceof Error ? err.message : err)
  }
}

/**
 * 기존 CollectionRun을 이어받아 수집 실행 (수동 수집 폴링용)
 * Step 1(레코드 생성)을 건너뛰고 기존 runId로 Step 2~9 실행
 */
export async function runCollectionForRun(runId: string): Promise<void> {
  let downloadedFilePath: string | null = null

  try {
    // ── Step 2: 상태 → RUNNING ──
    await updateCollectionRun(runId, { status: 'RUNNING' })
    console.log(`[manual] 상태: RUNNING (runId: ${runId})`)

    // ── Step 3~7: 공통 파이프라인 ──
    downloadedFilePath = await executeCollectionPipeline(runId, true)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[manual] 수집 실패: ${errorMessage}`)
    try {
      await updateCollectionRun(runId, {
        status: 'FAILED',
        error: errorMessage.slice(0, 500),
      })
    } catch (updateError) {
      console.error('[manual] 상태 업데이트 실패:', updateError)
    }
    await notifyCollectionFailed(errorMessage).catch(() => {})
    throw error
  } finally {
    if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
      try {
        fs.unlinkSync(downloadedFilePath)
        console.log(`임시 파일 삭제: ${downloadedFilePath}`)
      } catch (cleanupError) {
        console.error('임시 파일 삭제 실패:', cleanupError)
      }
    }
  }
}

/**
 * 수집 파이프라인 실행
 *
 * 1. CollectionRun 생성 (PENDING)
 * 2. 상태 → RUNNING
 * 3. 자격증명 복호화
 * 4. Playwright로 Excel 다운로드
 * 5. 상태 → DOWNLOADING → PARSING
 * 6. 파일 읽기 → 업로드 API 호출
 * 7. 상태 → COMPLETED
 * 8. 에러 시 → FAILED
 * 9. 임시 파일 정리
 */
export async function runCollection(triggeredBy: string = 'scheduled'): Promise<void> {
  let runId: string | null = null
  let downloadedFilePath: string | null = null

  try {
    // ── Step 1: CollectionRun 생성 ──
    console.log('CollectionRun 생성 중...')
    const run = await createCollectionRun(triggeredBy)
    runId = run.id
    console.log(`CollectionRun 생성됨: ${runId}`)

    // ── Step 2: 상태 → RUNNING ──
    await updateCollectionRun(runId, { status: 'RUNNING' })
    console.log('상태: RUNNING')

    // ── Step 3~7: 공통 파이프라인 ──
    downloadedFilePath = await executeCollectionPipeline(runId)
  } catch (error) {
    // ── Step 8: 에러 시 → FAILED ──
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`수집 실패: ${errorMessage}`)

    if (runId) {
      try {
        await updateCollectionRun(runId, {
          status: 'FAILED',
          error: errorMessage.slice(0, 500), // 에러 메시지 길이 제한
        })
        console.log('상태: FAILED')
      } catch (updateError) {
        console.error('상태 업데이트 실패:', updateError)
      }
    }

    throw error
  } finally {
    // ── Step 9: 임시 파일 정리 ──
    if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
      try {
        fs.unlinkSync(downloadedFilePath)
        console.log(`임시 파일 삭제: ${downloadedFilePath}`)
      } catch (cleanupError) {
        console.error('임시 파일 삭제 실패:', cleanupError)
      }
    }
  }
}

/** Step 3~7 공통 파이프라인 — 자격증명 → 다운로드 → 파싱 → 업로드 → 완료 */
async function executeCollectionPipeline(runId: string, isManual = false): Promise<string | null> {
  // ── Step 3: 자격증명 복호화 ──
  console.log('자격증명 조회 및 복호화 중...')
  const credential = await getCredentials()
  // iv가 'none'이면 평문 저장 (ENCRYPTION_KEY 미설정 환경)
  const password =
    credential.passwordIv === 'none'
      ? credential.encryptedPassword
      : decrypt(credential.encryptedPassword, credential.passwordIv)

  // ── Step 4: Playwright로 Excel 다운로드 ──
  console.log('쿠팡 광고센터 수집 시작...')
  await updateCollectionRun(runId, { status: 'DOWNLOADING' })
  console.log('상태: DOWNLOADING')

  // 수동 수집: 최근 7일, 자동 수집: 어제 1일 (KST 기준)
  function kstDate(offsetDays: number): string {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    kst.setDate(kst.getDate() + offsetDays)
    return kst.toISOString().split('T')[0]
  }
  const dateFrom = isManual ? kstDate(-7) : kstDate(-1)
  const dateTo = kstDate(-1)
  const dateOptions = { dateFrom, dateTo }

  const result = await collectCoupangReport(
    {
      loginId: credential.loginId,
      password,
    },
    dateOptions
  )

  console.log(`파일 다운로드 완료: ${result.fileName}`)

  // ── Step 4.5: 다운로드 파일 날짜 범위 검증 ──
  const fileBuffer = fs.readFileSync(result.filePath)
  verifyDownloadedFile(Buffer.from(fileBuffer), result.fileName, dateTo)

  // ── Step 5: 상태 → PARSING ──
  await updateCollectionRun(runId, { status: 'PARSING' })
  console.log('상태: PARSING')

  // ── Step 6: 파일 읽기 → 업로드 API 호출 ──
  console.log('파일 업로드 중...')
  const uploadResult = await uploadReport(
    Buffer.from(fileBuffer),
    result.fileName,
    credential.workspaceId
  )

  console.log(
    `업로드 완료 — 삽입: ${uploadResult.insertedRows}, 중복: ${uploadResult.duplicateRows}, 전체: ${uploadResult.totalRows}`
  )

  // ── Step 7: 상태 → COMPLETED ──
  await updateCollectionRun(runId, {
    status: 'COMPLETED',
    uploadId: uploadResult.uploadId,
  })
  console.log('상태: COMPLETED')

  // ── Step 8: Slack 알림 전송 ──
  // 실제 수집 기간 (upload 응답의 ISO 날짜를 KST로 변환) 또는 의도된 기간 (fallback)
  function toKSTDateStr(isoStr: string): string {
    const d = new Date(isoStr)
    return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
  }
  const actualStart = uploadResult.periodStart ? toKSTDateStr(uploadResult.periodStart) : dateFrom
  const actualEnd = uploadResult.periodEnd ? toKSTDateStr(uploadResult.periodEnd) : dateTo
  await notifyCollectionDone({
    dateRange: `${actualStart} ~ ${actualEnd}`,
    totalRows: uploadResult.totalRows,
    insertedRows: uploadResult.insertedRows,
    duplicateRows: uploadResult.duplicateRows,
  }).catch((err) => console.error('[slack] 알림 전송 실패:', err))

  // ── Step 9: 재고 데이터 수집 (Wing) ──
  // 광고 수집기 context.close() 후 브라우저 데이터 디렉토리 잠금 해제 대기
  await new Promise((r) => setTimeout(r, 3000))

  let inventoryResult: { healthRows?: number; vendorRows?: number; errors: string[] } = {
    errors: [],
  }
  try {
    console.log('\n[orchestrator] 재고 데이터 수집 시작...')
    // collectVendorSales 플래그를 credential에서 그대로 전달
    inventoryResult = await collectAndUploadInventory({
      ...credential,
      collectVendorSales: credential.collectVendorSales,
    })
    console.log(`[orchestrator] 재고 수집 완료 — 건강성: ${inventoryResult.healthRows ?? 0}건`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[orchestrator] 재고 수집 실패 (광고 데이터는 정상): ${msg}`)
    inventoryResult.errors.push(msg)
  }

  // ── Step 10: 재고 수집 결과 Slack 알림 ──
  await notifyInventoryDone(inventoryResult).catch((err) =>
    console.error('[slack] 재고 알림 전송 실패:', err)
  )

  // ── Step 10.5: 재고 분석 트리거 ──
  await triggerInventoryAnalysis(credential.workspaceId).catch((err) =>
    console.error('[orchestrator] 재고 분석 트리거 실패:', err)
  )

  // ── Step 11: 수집 후 자동 분석 트리거 ──
  await triggerAnalysisAfterCollection(credential.workspaceId, actualStart, actualEnd).catch(
    (err) => console.error('[orchestrator] 수집 후 분석 트리거 실패:', err)
  )

  // ── Step 12: seller-ops 연동 — 로켓그로스 판매 OUTBOUND 변환 트리거 + 판매 Slack 알림 ──
  // 수집 직후 호출해야 정확(VENDOR 스냅샷이 방금 적재됨).
  // 자동 재고 대조(inventory-sync)는 제거됨 — 재고 truth = OUTBOUND 차감 + 사용자 수동 대조.
  // VENDOR 수집을 한 경우에만 판매 알림(변환 트리거는 전 Space 대상이라 항상 호출).
  // cron 일일 수집 = 어제 1일치 VENDOR.
  const salesDateKst = new Date(Date.now() + 9 * 3600 * 1000 - 86400 * 1000)
    .toISOString()
    .slice(0, 10)
  const vendorCollected = (inventoryResult.vendorRows ?? 0) > 0
  await triggerSellerOpsSync(salesDateKst, vendorCollected, isManual).catch((err) =>
    console.error('[orchestrator] seller-ops 동기화 트리거 실패:', err)
  )

  return result.filePath
}

/**
 * seller-ops 연동 트리거 — 수집 후 로켓그로스 판매 OUTBOUND 변환(재고 차감).
 * 워커 인증(x-worker-api-key)으로 sales-sync 라우트를 직접 호출.
 * 전 Space 를 쓸어 처리하므로 workspaceId 불필요.
 *
 * 변환 응답의 totals(매출/주문/판매량/converted)로 판매 수집 완료 Slack 알림을 발송한다.
 * @param salesDateRange 판매(VENDOR) 수집 대상 KST 일자 범위 (cron=어제 1일)
 * @param vendorCollected 이번 사이클에 VENDOR 를 실제 수집했는지 — false면 변환만 하고 알림 생략
 *                        (변환은 전 Space 의 어제 기존 데이터 대상이라 항상 호출하되,
 *                         이번 수집이 없으면 stale 데이터로 "수집 완료" 알림이 나가지 않게).
 */
async function triggerSellerOpsSync(
  salesDateRange: string,
  vendorCollected: boolean,
  isManual: boolean
): Promise<void> {
  const baseUrl = process.env.WORKDECK_API_URL?.replace(/\/$/, '')
  const apiKey = process.env.WORKER_API_KEY
  if (!baseUrl || !apiKey) return

  const headers = { 'x-worker-api-key': apiKey }
  // 판매 OUTBOUND 변환(수요 신호 + 재고 차감). trigger 로 이력 잡 라벨 구분(manual/scheduled).
  const trigger = isManual ? 'manual' : 'scheduled'
  try {
    const r = await fetch(`${baseUrl}/api/cron/coupang-sales-sync?trigger=${trigger}`, { headers })
    console.log(`[orchestrator] 쿠팡 판매 변환 트리거: ${r.status}`)
    if (!r.ok) return

    // 이번 사이클에 VENDOR 수집이 없었으면 알림 생략 (stale 데이터 오발송 방지)
    if (!vendorCollected) return

    const data = (await r.json().catch(() => null)) as {
      totals?: { converted?: number; revenue?: number; orderCount?: number; salesQty?: number }
    } | null
    const t = data?.totals
    if (!t) return

    // 판매 수집 완료 Slack 알림 (cron 일일)
    await notifyVendorSalesDone({
      mode: 'daily',
      dateRange: salesDateRange,
      outboundCount: t.converted ?? 0,
      revenue: t.revenue ?? 0,
      orderCount: t.orderCount ?? 0,
      salesQty: t.salesQty ?? 0,
    }).catch((err: unknown) => console.error('[slack] 판매 알림 전송 실패:', err))
  } catch (err) {
    console.error('[orchestrator] 쿠팡 판매 변환 트리거 실패:', err)
  }
}

/** Wing에서 재고 데이터를 수집하고 업로드한다 */
async function collectAndUploadInventory(credential: {
  loginId: string
  encryptedPassword: string
  passwordIv: string
  workspaceId: string
  /** false면 판매분석(VENDOR) 수집 생략, inventory_health만 수집 */
  collectVendorSales?: boolean
}): Promise<{ healthRows?: number; vendorRows?: number; errors: string[] }> {
  const password =
    credential.passwordIv === 'none'
      ? credential.encryptedPassword
      : decrypt(credential.encryptedPassword, credential.passwordIv)

  // 어제 KST 날짜 계산 — 판매분석 수집 대상일 및 snapshotDate 기준
  // kstDayRange(date) 패턴과 동일하게: UTC 기준 +9h 적용 후 YYYY-MM-DD 추출
  const yesterdayKst = new Date(Date.now() + 9 * 3600 * 1000 - 86400 * 1000)
    .toISOString()
    .slice(0, 10)
  // VENDOR snapshotDate: 어제 KST 자정 instant (UTC 전날 15:00)
  // coupang-sales-to-movement.ts 의 kstDayRange 가 `${key}T00:00:00+09:00` 범위로 조회하므로
  // 이 instant 이 그 범위 [00:00 KST, 24:00 KST) 에 속하면 정확히 매칭된다.
  const yesterdayKstIso = new Date(`${yesterdayKst}T00:00:00+09:00`).toISOString()

  // collectVendorSales=false면 VENDOR 수집 생략 — targetDateKst를 넘기지 않아 판매분석 건너뜀
  const shouldCollectVendor = credential.collectVendorSales !== false
  const inventoryData = await collectInventoryData(
    { loginId: credential.loginId, password },
    shouldCollectVendor ? { targetDateKst: yesterdayKst } : {}
  )
  if (!shouldCollectVendor) {
    console.log('[inventory] collectVendorSales=false — 판매분석(VENDOR) 수집 건너뜀')
  }

  const errors: string[] = []
  let healthRows: number | undefined
  let vendorRows: number | undefined

  // 재고 건강성 업로드
  if (inventoryData.inventoryHealth) {
    try {
      const buffer = fs.readFileSync(inventoryData.inventoryHealth.filePath)
      const result = await uploadInventory(
        Buffer.from(buffer),
        inventoryData.inventoryHealth.fileName,
        credential.workspaceId
      )
      healthRows = result.insertedRows
      console.log(`[inventory] 재고 건강성 업로드: ${result.insertedRows}건`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[inventory] 재고 건강성 업로드 실패: ${msg}`)
      errors.push(`재고 건강성 업로드: ${msg}`)
    } finally {
      // 임시 파일 삭제
      try {
        fs.unlinkSync(inventoryData.inventoryHealth.filePath)
      } catch {}
    }
  } else if (inventoryData.inventoryHealthError) {
    // 다운로드 자체 실패 — 이전에는 무음으로 통과했지만 이제 errors로 전파
    errors.push(`재고 건강성 다운로드: ${inventoryData.inventoryHealthError}`)
  } else {
    errors.push('재고 건강성 다운로드: 결과 파일 없음 (원인 미식별)')
  }

  // 판매분석(VENDOR) 업로드 — snapshotDate = 어제 KST 자정
  if (inventoryData.salesVendor) {
    try {
      const buffer = fs.readFileSync(inventoryData.salesVendor.filePath)
      const result = await uploadInventory(
        Buffer.from(buffer),
        inventoryData.salesVendor.fileName,
        credential.workspaceId,
        yesterdayKstIso
      )
      vendorRows = result.insertedRows
      console.log(
        `[inventory] 판매분석(VENDOR) 업로드: ${result.insertedRows}건 (snapshotDate: ${yesterdayKst})`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[inventory] 판매분석(VENDOR) 업로드 실패: ${msg}`)
      errors.push(`판매분석 VENDOR 업로드: ${msg}`)
    } finally {
      // 임시 파일 삭제
      try {
        fs.unlinkSync(inventoryData.salesVendor.filePath)
      } catch {}
    }
  } else if (inventoryData.salesVendorError) {
    errors.push(`판매분석 VENDOR 다운로드: ${inventoryData.salesVendorError}`)
  } else {
    errors.push('판매분석 VENDOR 다운로드: 결과 파일 없음 (원인 미식별)')
  }

  return { healthRows, vendorRows, errors }
}

/** 재고 분석 트리거 — 재고 수집 완료 후 항상 실행, Slack 발송 포함 */
async function triggerInventoryAnalysis(workspaceId: string): Promise<void> {
  const baseUrl = process.env.WORKDECK_API_URL?.replace(/\/$/, '')
  const apiKey = process.env.WORKER_API_KEY
  if (!baseUrl || !apiKey) return

  console.log('[orchestrator] 재고 분석 트리거 실행 (worker 전용 엔드포인트)')

  const res = await fetch(`${baseUrl}/api/inventory/analysis/worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-worker-api-key': apiKey },
    body: JSON.stringify({ workspaceId }),
  })

  if (res.ok) {
    const data = await res.json()
    console.log(
      `[orchestrator] 재고 분석 완료: analysisId=${data.analysisId}, slackAttempted=${data.slackAttempted}, slackDelivered=${data.slackDelivered}`
    )
  } else {
    const body = await res.text()
    console.error(`[orchestrator] 재고 분석 실패 [${res.status}]: ${body}`)
  }
}

/** 수집 후 자동 분석 트리거 — triggerAfterCollection이 활성화된 경우만 */
async function triggerAnalysisAfterCollection(
  workspaceId: string,
  _dateFrom: string,
  _dateTo: string
): Promise<void> {
  // 스케줄 확인
  const baseUrl = process.env.WORKDECK_API_URL?.replace(/\/$/, '')
  const apiKey = process.env.WORKER_API_KEY
  if (!baseUrl || !apiKey) return

  const scheduleRes = await fetch(`${baseUrl}/api/analysis/schedule/active`, {
    headers: { 'Content-Type': 'application/json', 'x-worker-api-key': apiKey },
  })
  if (!scheduleRes.ok) return

  const { schedules } = (await scheduleRes.json()) as {
    schedules: Array<{
      workspaceId: string
      triggerAfterCollection: boolean
      intervalDays: number
      lastAnalyzedAt: string | null
    }>
  }
  const schedule = schedules.find((s) => s.workspaceId === workspaceId && s.triggerAfterCollection)
  if (!schedule) return

  // intervalDays 경과 여부 확인 — 분석 간격이 지나야 수집 후 자동 분석
  if (schedule.lastAnalyzedAt) {
    const lastAnalyzed = new Date(schedule.lastAnalyzedAt)
    const diffDays = (Date.now() - lastAnalyzed.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays < schedule.intervalDays) {
      console.log(
        `[orchestrator] 수집 후 분석 스킵 — 마지막 분석으로부터 ${diffDays.toFixed(1)}일 (간격: ${schedule.intervalDays}일)`
      )
      return
    }
  }

  console.log('[orchestrator] 수집 후 자동 분석 트리거 실행')

  // 항상 최근 30일 기준으로 종합 분석
  const now = new Date()
  const from30 = new Date(now)
  from30.setDate(from30.getDate() - 30)
  const formatDate = (d: Date) => d.toISOString().split('T')[0]

  const triggerRes = await fetch(`${baseUrl}/api/analysis/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-worker-api-key': apiKey },
    body: JSON.stringify({
      workspaceId,
      from: formatDate(from30),
      to: formatDate(now),
      reportType: 'DAILY_REVIEW',
      triggeredBy: 'collection',
    }),
  })

  if (triggerRes.ok) {
    const data = await triggerRes.json()
    console.log(`[orchestrator] 분석 트리거 완료: reportId=${data.reportId}`)
  } else {
    const body = await triggerRes.text()
    console.error(`[orchestrator] 분석 트리거 실패 [${triggerRes.status}]: ${body}`)
  }
}
