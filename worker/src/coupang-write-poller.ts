/**
 * 쿠팡 쓰기 잡 폴링 — manual-poller 와 같은 패턴(30초, isProcessing 락).
 * 워커에는 HTTP 수신부가 없어 앱이 잡을 밀어줄 수 없다.
 *
 * 이 상태머신은 워커 프로세스가 정확히 1개라는 전제로 설계돼 있다(claim 게이트가
 * DB updateMany 로 경합은 막지만, 잡을 잃어버리지 않는 재시도는 하지 않는다).
 * 워커를 2개 이상 동시에 띄우려면 claim 시점에 워커별 토큰(claim token)을 발급해
 * report 시점에 검증하는 방식이 필요하다 — 지금은 하지 않는다.
 */
import {
  claimWriteJob,
  reportWriteJob,
  getApiCredential,
  type ApiCredentialResponse,
} from './api-client.js'
import { decrypt } from './encryption.js'
import { CoupangApiClient } from './coupang-api/client.js'
import { runPriceChange } from './write-jobs/price-change.js'
import { runProductSync } from './write-jobs/product-sync.js'

const POLL_INTERVAL = 30_000
let isProcessing = false

/**
 * 자격증명으로 API 클라이언트를 만든다. accessKey 는 평문 저장이라 그대로 쓴다
 * (app/api/collection/api-credentials/route.ts 의 encryptSecret 은 secretKey 에만
 * 적용된다 — accessKey 를 복호화하면 매번 400/401 로 실패한다). secretKey 만
 * encryptionIv 로 복호화하며, 'none' 이면 평문 폴백(backfill-poller.ts 와 동일 처리).
 */
export function buildApiClient(credential: NonNullable<ApiCredentialResponse>): CoupangApiClient {
  const secretKey =
    credential.encryptionIv === 'none'
      ? credential.secretKey
      : decrypt(credential.secretKey, credential.encryptionIv)
  return new CoupangApiClient({
    vendorId: credential.vendorId,
    accessKey: credential.accessKey,
    secretKey,
  })
}

export function startCoupangWritePoller(): void {
  setInterval(async () => {
    if (isProcessing) return
    // 클레임 요청이 30초 tick 을 넘겨 대기하면 다음 tick 이 잠금 없이 들어와
    // 잡을 중복 claim 할 수 있다 — 락은 claim 시도 자체를 감싸야 한다.
    isProcessing = true
    let job: Awaited<ReturnType<typeof claimWriteJob>> = null
    try {
      job = await claimWriteJob()
      if (!job) return

      console.log(`\n[coupang-write-poller] 잡 claim: ${job.id} (${job.kind})`)

      const credential = await getApiCredential()
      if (!credential) throw new Error('쿠팡 API 자격이 등록되어 있지 않습니다')
      const client = buildApiClient(credential)

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
        // 보고까지 실패하면 잡은 RUNNING 에 남고 reap cron 이 같은 PUT 을 다시 쏜다.
        // 최소한 흔적은 남긴다.
        const jobId = job.id
        await reportWriteJob(jobId, { status: 'FAILED', error: message }).catch((e) =>
          console.error(
            `[coupang-write-poller] 실패 보고 전송 실패(job=${jobId}):`,
            e instanceof Error ? e.message : e
          )
        )
      }
    } finally {
      isProcessing = false
    }
  }, POLL_INTERVAL)

  console.log(`쿠팡 쓰기 잡 폴링 시작 (${POLL_INTERVAL / 1000}초 간격)`)
}
