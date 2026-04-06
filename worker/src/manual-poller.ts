/**
 * 수동 수집 폴링 모듈
 * 30초마다 PENDING 상태의 수동 수집을 확인하고 실행한다.
 */
import { getPendingRun } from './api-client.js'
import { runCollectionForRun } from './orchestrator.js'

const POLL_INTERVAL = 30_000 // 30초
let isProcessing = false

export function startManualPoller(): void {
  setInterval(async () => {
    if (isProcessing) return

    try {
      const run = await getPendingRun()
      if (!run) return

      console.log(`\n[manual-poller] PENDING 수집 발견: ${run.id}`)
      isProcessing = true

      try {
        await runCollectionForRun(run.id)
        console.log(`[manual-poller] 수집 완료: ${run.id}`)
      } catch (err) {
        console.error(`[manual-poller] 수집 실패: ${run.id}`, err)
      } finally {
        isProcessing = false
      }
    } catch (err) {
      // API 서버 미실행 등 — 조용히 무시
    }
  }, POLL_INTERVAL)

  console.log(`수동 수집 폴링 시작 (${POLL_INTERVAL / 1000}초 간격)`)
}
