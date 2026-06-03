/**
 * 판매분석 VENDOR 콜드스타트 백필 스크립트
 *
 * 용도: 발주예측이 신규 로켓그로스에 대해 과거 N일치 VENDOR 데이터가 없어
 *       90일 zero-fill 구간이 생기는 문제를 방지하기 위한 1회용 백필.
 *
 * 실행: npm run backfill-sales [일수=90]
 *       예) npm run backfill-sales 30  → 어제부터 30일 전까지 수집
 *
 * 멱등: 같은 (workspaceId, snapshotDate, VENDOR_ITEM_METRICS) 재업로드는
 *       processInventoryUpload 의 덮어쓰기 로직이 처리하므로 재실행 안전.
 */

import 'dotenv/config'
import fs from 'node:fs'
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

// ─── 메인 ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawDays = process.argv[2]
  const totalDays = rawDays ? parseInt(rawDays, 10) : 90
  if (isNaN(totalDays) || totalDays < 1) {
    console.error('일수는 1 이상의 정수여야 합니다. 예: npm run backfill-sales 90')
    process.exit(1)
  }

  console.log(`\n=== 판매분석 VENDOR 백필 시작 (대상: 어제 ~ ${totalDays}일 전) ===\n`)

  // ── credential 조회 ──
  // orchestrator 와 동일하게 단일 credential API 사용
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

  const creds = { loginId: credential.loginId, password }
  const { workspaceId } = credential

  // ── 대상 날짜 목록 생성: 어제(offset=1) → N일 전(offset=totalDays) ──
  const dates: string[] = []
  for (let i = 1; i <= totalDays; i++) {
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
  const failedDates: string[] = []

  // ── Wing 세션 1개를 열고 날짜 루프 ──
  console.log('[backfill] Wing 세션 시작...')
  let session: Awaited<ReturnType<typeof openWingSession>>
  try {
    session = await openWingSession(creds)
  } catch (err) {
    console.error('[backfill] Wing 세션 열기 실패:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  const { context, page, downloadDir } = session

  try {
    for (const dateKst of dates) {
      console.log(`\n[backfill] ── ${dateKst} 수집 중...`)

      // 1) 다운로드
      const downloadResult = await downloadSalesAnalysisVendorOnPage(page, downloadDir, dateKst)

      if ('error' in downloadResult) {
        console.error(`[backfill]   ✗ 다운로드 실패 (${dateKst}): ${downloadResult.error}`)
        failed++
        failedDates.push(dateKst)
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

      // rate-limit 방어: 날짜 간 2~3초 sleep
      await sleep(2000 + Math.random() * 1000)
    }
  } finally {
    await context.close()
    console.log('\n[backfill] Wing 세션 종료')
  }

  // ── 최종 요약 ──
  console.log('\n=== 백필 완료 요약 ===')
  console.log(`  성공: ${succeeded}일 / 총 ${dates.length}일`)
  console.log(`  실패: ${failed}일`)
  console.log(`  총 삽입: ${totalInserted}건`)
  if (failedDates.length > 0) {
    console.log(`  실패 날짜: ${failedDates.join(', ')}`)
  }
  console.log('====================')

  // 이 스크립트는 VENDOR 레코드만 적재한다. 발주예측이 읽는 OUTBOUND 이동으로
  // 변환하려면 app-side 변환을 1회 실행해야 한다(워커는 prisma 미보유 + cron 인증 분리).
  // 과거 범위는 stockNeutral(재고 미차감)로 변환된다.
  const oldest = dates[dates.length - 1]
  const newest = dates[0]
  console.log('\n[다음 단계] OUTBOUND 변환 (app-side, CRON_SECRET 필요):')
  console.log(
    `  curl -H "Authorization: Bearer $CRON_SECRET" \\\n    "$WORKDECK_APP_URL/api/cron/coupang-sales-sync?from=${oldest}&to=${newest}"`
  )
  console.log('  (120일 초과 시 범위를 나눠 호출)\n')

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[backfill] 예상치 못한 오류:', err)
  process.exit(1)
})
