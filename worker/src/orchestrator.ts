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

    // ── Step 3: 자격증명 복호화 ──
    console.log('자격증명 조회 및 복호화 중...')
    const credential = await getCredentials()
    const password = decrypt(credential.encryptedPassword, credential.passwordIv)

    // ── Step 4: Playwright로 Excel 다운로드 ──
    console.log('쿠팡 광고센터 수집 시작...')
    await updateCollectionRun(runId, { status: 'DOWNLOADING' })
    console.log('상태: DOWNLOADING')

    const result = await collectCoupangReport({
      loginId: credential.loginId,
      password,
    })

    downloadedFilePath = result.filePath
    console.log(`파일 다운로드 완료: ${result.fileName}`)

    // ── Step 5: 상태 → PARSING ──
    await updateCollectionRun(runId, { status: 'PARSING' })
    console.log('상태: PARSING')

    // ── Step 6: 파일 읽기 → 업로드 API 호출 ──
    console.log('파일 업로드 중...')
    const fileBuffer = fs.readFileSync(result.filePath)
    const uploadResult = await uploadReport(Buffer.from(fileBuffer), result.fileName)

    console.log(
      `업로드 완료 — 삽입: ${uploadResult.insertedRows}, 중복: ${uploadResult.duplicateRows}, 전체: ${uploadResult.totalRows}`
    )

    // ── Step 7: 상태 → COMPLETED ──
    await updateCollectionRun(runId, {
      status: 'COMPLETED',
      uploadId: uploadResult.uploadId,
    })
    console.log('상태: COMPLETED')
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
