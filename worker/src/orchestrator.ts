/**
 * 수집 오케스트레이터
 * API 호출, 자격증명 복호화, Playwright 수집, 업로드까지 전체 파이프라인을 관리한다.
 */
import fs from 'node:fs'
import {
  createCollectionRun,
  updateCollectionRun,
  getCredentials,
  uploadReport,
} from './api-client.js'
import { decrypt } from './encryption.js'
import { collectCoupangReport } from './collector.js'
import { notifyCollectionDone, notifyCollectionFailed } from './slack-notifier.js'

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
  const password = credential.passwordIv === 'none'
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

  const result = await collectCoupangReport({
    loginId: credential.loginId,
    password,
  }, dateOptions)

  console.log(`파일 다운로드 완료: ${result.fileName}`)

  // ── Step 5: 상태 → PARSING ──
  await updateCollectionRun(runId, { status: 'PARSING' })
  console.log('상태: PARSING')

  // ── Step 6: 파일 읽기 → 업로드 API 호출 ──
  console.log('파일 업로드 중...')
  const fileBuffer = fs.readFileSync(result.filePath)
  const uploadResult = await uploadReport(Buffer.from(fileBuffer), result.fileName, credential.workspaceId)

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
  // 실제 수집 기간 (upload 응답) 또는 의도된 기간 (fallback)
  const actualStart = uploadResult.periodStart ? uploadResult.periodStart.split('T')[0] : dateFrom
  const actualEnd = uploadResult.periodEnd ? uploadResult.periodEnd.split('T')[0] : dateTo
  await notifyCollectionDone({
    dateRange: `${actualStart} ~ ${actualEnd}`,
    totalRows: uploadResult.totalRows,
    insertedRows: uploadResult.insertedRows,
    duplicateRows: uploadResult.duplicateRows,
  }).catch((err) => console.error('[slack] 알림 전송 실패:', err))

  return result.filePath
}
