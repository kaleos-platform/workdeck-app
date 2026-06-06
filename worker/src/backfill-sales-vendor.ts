/**
 * 판매분석 VENDOR 콜드스타트 백필
 *
 * 용도: 발주예측이 신규 로켓그로스에 대해 과거 N일치 VENDOR 데이터가 없어
 *       90일 zero-fill 구간이 생기는 문제를 방지하기 위한 백필.
 *
 * CLI 실행: npm run backfill-sales [일수=90]
 *            예) npm run backfill-sales 30  → 어제부터 30일 전까지 수집
 *
 * 프로그래밍 방식: runBackfill(days, creds, workspaceId) 호출
 *
 * 멱등: 같은 (workspaceId, snapshotDate, VENDOR_ITEM_METRICS) 재업로드는
 *       processInventoryUpload 의 덮어쓰기 로직이 처리하므로 재실행 안전.
 */

import 'dotenv/config'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getCredentials, uploadInventory } from './api-client.js'
import { decrypt } from './encryption.js'
import { openWingSession, downloadSalesAnalysisVendorOnPage } from './inventory-collector.js'

// ─── 유틸 ──────────────────────────────────────────────────────────────────────

/** ms 단위 sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** KST 기준 N일 전 YYYY-MM-DD 문자열 */
function kstDateOffset(offsetDays: number): string {
  return new Date(Date.now() + 9 * 3600 * 1000 - offsetDays * 86400 * 1000)
    .toISOString()
    .slice(0, 10)
}

/** YYYY-MM-DD → KST 자정 ISO (UTC 기준 전날 15:00) */
function toKstMidnightIso(dateKst: string): string {
  return new Date(`${dateKst}T00:00:00+09:00`).toISOString()
}

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export type BackfillCreds = {
  loginId: string
  password: string
}

export type BackfillResult = {
  succeeded: number
  failed: number
  totalInserted: number
  failedDates: string[]
  /** 백필 범위 oldest KST 날짜 (어제−days+1) */
  fromDate: string
  /** 백필 범위 newest KST 날짜 (어제) */
  toDate: string
}

export type BackfillProgressCallback = (params: {
  date: string
  succeeded: number
  failed: number
  total: number
}) => void

// ─── 재사용 가능한 핵심 함수 ──────────────────────────────────────────────────

/**
 * 과거 N일치 VENDOR 판매분석을 Wing에서 수집해 API에 업로드한다.
 *
 * @param days       수집할 일수 (1~120)
 * @param creds      Wing 로그인 자격증명 (복호화된 평문 패스워드)
 * @param workspaceId 업로드 대상 워크스페이스 ID
 * @param onProgress  진행 콜백 (선택)
 * @param shouldCancel 날짜 루프 사이에 호출되어 true 면 즉시 중단(사용자 취소 감지). 선택.
 */
export async function runBackfill(
  days: number,
  creds: BackfillCreds,
  workspaceId: string,
  onProgress?: BackfillProgressCallback,
  shouldCancel?: () => Promise<boolean>
): Promise<BackfillResult & { cancelled?: boolean }> {
  // ── 대상 날짜 목록 생성: 어제(offset=1) → N일 전(offset=days) ──
  const dates: string[] = []
  for (let i = 1; i <= days; i++) {
    dates.push(kstDateOffset(i))
  }

  console.log(`[backfill] workspaceId: ${workspaceId}`)
  console.log(
    `[backfill] 대상 날짜: ${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length}일)\n`
  )

  // 요약 카운터
  let succeeded = 0
  let failed = 0
  let totalInserted = 0
  let cancelled = false
  const failedDates: string[] = []

  // ── Wing 세션 1개를 열고 날짜 루프 ──
  console.log('[backfill] Wing 세션 시작...')
  const session = await openWingSession(creds)
  const { context, page, downloadDir } = session

  try {
    for (const dateKst of dates) {
      // 사용자 취소 감지 — 각 날짜 시작 전 확인해 조기 종료(이미 수집한 날짜는 보존).
      if (shouldCancel && (await shouldCancel().catch(() => false))) {
        console.log('[backfill] 사용자 취소 감지 — 백필 중단')
        cancelled = true
        break
      }

      console.log(`\n[backfill] ── ${dateKst} 수집 중...`)

      // 1) 다운로드
      const downloadResult = await downloadSalesAnalysisVendorOnPage(page, downloadDir, dateKst)

      if ('error' in downloadResult) {
        console.error(`[backfill]   ✗ 다운로드 실패 (${dateKst}): ${downloadResult.error}`)
        failed++
        failedDates.push(dateKst)
        onProgress?.({ date: dateKst, succeeded, failed, total: dates.length })
        // rate-limit 방어 sleep 후 다음 날짜로 계속
        await sleep(3000)
        continue
      }

      const { filePath, fileName } = downloadResult

      // 2) 업로드
      try {
        const buffer = fs.readFileSync(filePath)
        const snapshotDateIso = toKstMidnightIso(dateKst)
        const result = await uploadInventory(
          Buffer.from(buffer),
          fileName,
          workspaceId,
          snapshotDateIso
        )

        if (result.success === false || result.error) {
          throw new Error(result.error ?? '업로드 응답 success=false')
        }

        console.log(
          `[backfill]   ✓ ${dateKst} 업로드 완료 — ${result.insertedRows}건 (snapshotDate: ${snapshotDateIso})`
        )
        succeeded++
        totalInserted += result.insertedRows ?? 0
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[backfill]   ✗ 업로드 실패 (${dateKst}): ${msg}`)
        failed++
        failedDates.push(dateKst)
      } finally {
        // 임시 파일 삭제
        try {
          fs.unlinkSync(filePath)
        } catch {}
      }

      onProgress?.({ date: dateKst, succeeded, failed, total: dates.length })

      // rate-limit 방어: 날짜 간 2~3초 sleep
      await sleep(2000 + Math.random() * 1000)
    }
  } finally {
    await context.close()
    console.log('\n[backfill] Wing 세션 종료')
  }

  return {
    succeeded,
    failed,
    totalInserted,
    failedDates,
    fromDate: dates[dates.length - 1], // oldest
    toDate: dates[0], // newest (어제)
    cancelled,
  }
}

// ─── CLI 진입점 ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawDays = process.argv[2]
  const totalDays = rawDays ? parseInt(rawDays, 10) : 90
  if (isNaN(totalDays) || totalDays < 1) {
    console.error('일수는 1 이상의 정수여야 합니다. 예: npm run backfill-sales 90')
    process.exit(1)
  }

  console.log(`\n=== 판매분석 VENDOR 백필 시작 (대상: 어제 ~ ${totalDays}일 전) ===\n`)

  // ── credential 조회 ──
  let credential: Awaited<ReturnType<typeof getCredentials>>
  try {
    credential = await getCredentials()
  } catch (err) {
    console.error('자격증명 조회 실패:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  const password =
    credential.passwordIv === 'none'
      ? credential.encryptedPassword
      : decrypt(credential.encryptedPassword, credential.passwordIv)

  const creds: BackfillCreds = { loginId: credential.loginId, password }

  // ── 백필 실행 ──
  let result: BackfillResult
  try {
    result = await runBackfill(totalDays, creds, credential.workspaceId)
  } catch (err) {
    console.error('[backfill] 백필 실행 실패:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  // ── 최종 요약 ──
  console.log('\n=== 백필 완료 요약 ===')
  console.log(`  성공: ${result.succeeded}일 / 총 ${totalDays}일`)
  console.log(`  실패: ${result.failed}일`)
  console.log(`  총 삽입: ${result.totalInserted}건`)
  if (result.failedDates.length > 0) {
    console.log(`  실패 날짜: ${result.failedDates.join(', ')}`)
  }
  console.log('====================')

  // 이 스크립트는 VENDOR 레코드만 적재한다. 발주예측이 읽는 OUTBOUND 이동으로
  // 변환하려면 app-side 변환을 1회 실행해야 한다(워커는 prisma 미보유).
  // 변환 엔드포인트는 x-worker-api-key 인증이므로 WORKER_API_KEY 가 필요하다.
  console.log('\n[다음 단계] OUTBOUND 변환 (app-side, x-worker-api-key 인증):')
  console.log(
    `  curl -H "x-worker-api-key: $WORKER_API_KEY" \\\n    "$WORKDECK_APP_URL/api/cron/coupang-sales-sync?from=${result.fromDate}&to=${result.toDate}"`
  )
  console.log('  (120일 초과 시 범위를 나눠 호출)\n')

  if (result.failed > 0) {
    process.exit(1)
  }
}

// CLI 직접 실행(npm run backfill-sales) 시에만 main() 실행.
// 모듈 import(backfill-poller 가 runBackfill 재사용) 시 top-level 자동 실행을 막는다.
// 이 가드가 없으면 import 만으로 잡 없이 90일 백필이 돌아 워커가 crash loop 에 빠진다.
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirectRun) {
  main().catch((err) => {
    console.error('[backfill] 예상치 못한 오류:', err)
    process.exit(1)
  })
}
