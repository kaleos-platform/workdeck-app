/**
 * 쿠팡 쓰기 잡 폴링 — manual-poller 와 같은 패턴(30초, isProcessing 락).
 * 워커에는 HTTP 수신부가 없어 앱이 잡을 밀어줄 수 없다.
 */
import { claimWriteJob, reportWriteJob, getApiCredential } from './api-client.js'
import { decrypt } from './encryption.js'
import { CoupangApiClient } from './coupang-api/client.js'
import { runPriceChange } from './write-jobs/price-change.js'
import { runProductSync } from './write-jobs/product-sync.js'

const POLL_INTERVAL = 30_000
let isProcessing = false

export function startCoupangWritePoller(): void {
  setInterval(async () => {
    if (isProcessing) return
    let job: Awaited<ReturnType<typeof claimWriteJob>> = null
    try {
      job = await claimWriteJob()
      if (!job) return
      isProcessing = true

      console.log(`\n[coupang-write-poller] 잡 claim: ${job.id} (${job.kind})`)

      const credential = await getApiCredential()
      if (!credential) throw new Error('쿠팡 API 자격이 등록되어 있지 않습니다')
      // encryptionIv==='none' 이면 평문 저장(getApiCredential 타입 주석 참조) — backfill-poller 와 동일 처리.
      const decryptField = (value: string) =>
        credential.encryptionIv === 'none' ? value : decrypt(value, credential.encryptionIv)
      const client = new CoupangApiClient({
        vendorId: credential.vendorId,
        accessKey: decryptField(credential.accessKey),
        secretKey: decryptField(credential.secretKey),
      })

      if (job.kind === 'PRICE_CHANGE') {
        const results = await runPriceChange(client, job.payload)
        const okCount = results.filter((r) => r.ok).length
        await reportWriteJob(job.id, {
          status: okCount === results.length ? 'SUCCEEDED' : okCount === 0 ? 'FAILED' : 'PARTIAL',
          results,
        })
      } else {
        const summary = await runProductSync(client, credential.vendorId, job.spaceId)
        await reportWriteJob(job.id, { status: 'SUCCEEDED', results: [summary] })
      }

      console.log(`[coupang-write-poller] 잡 완료: ${job.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[coupang-write-poller] 잡 실패:', message)
      if (job) {
        await reportWriteJob(job.id, { status: 'FAILED', error: message }).catch(() => {})
      }
    } finally {
      isProcessing = false
    }
  }, POLL_INTERVAL)

  console.log(`쿠팡 쓰기 잡 폴링 시작 (${POLL_INTERVAL / 1000}초 간격)`)
}
