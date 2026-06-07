/**
 * 백필 잡 폴링 모듈
 *
 * 60초마다 /api/collection/backfill/worker 를 폴링해 PENDING 잡을 claim 하고
 * runBackfill 로 과거 N일치 VENDOR 수집 → OUTBOUND 변환 체이닝까지 처리한다.
 *
 * 잡 1건이 최대 120일 × ~3초 = ~6분, 여유를 두어 isProcessing 가드로 중복 실행 방지.
 */

import { runBackfill, type BackfillCreds } from './backfill-sales-vendor.js'
import { decrypt } from './encryption.js'
import { notifyVendorSalesDone } from './slack-notifier.js'

const POLL_INTERVAL = 60_000 // 60초
const BASE_URL = (): string => {
  const url = process.env.WORKDECK_API_URL
  if (!url) throw new Error('WORKDECK_API_URL 환경변수가 필요합니다')
  return url.replace(/\/$/, '')
}
const WORKER_API_KEY = (): string => {
  const key = process.env.WORKER_API_KEY
  if (!key) throw new Error('WORKER_API_KEY 환경변수가 필요합니다')
  return key
}
const WORKER_ID = process.env.BACKFILL_WORKER_ID ?? `backfill-worker-${process.pid}`

let isProcessing = false

// ─── API 헬퍼 ─────────────────────────────────────────────────────────────────

/** 워커 인증 헤더 공통 옵션 */
function workerHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-worker-api-key': WORKER_API_KEY(),
  }
}

type ClaimedBackfillJob = {
  id: string
  workspaceId: string
  days: number
  credential: {
    loginId: string
    encryptedPassword: string
    passwordIv: string
  }
}

/** 잡 상태 조회 — 워커가 RUNNING 중 사용자 취소(CANCELLED)를 감지하는 데 사용. */
async function fetchJobStatus(jobId: string): Promise<string | null> {
  try {
    const url = `${BASE_URL()}/api/collection/backfill/worker?jobId=${encodeURIComponent(jobId)}`
    const res = await fetch(url, { headers: workerHeaders() })
    if (!res.ok) return null
    const data = (await res.json()) as { job?: { status?: string } }
    return data.job?.status ?? null
  } catch {
    return null
  }
}

/** PENDING 잡 1건 claim. 없으면 null 반환. */
async function claimBackfillJob(): Promise<ClaimedBackfillJob | null> {
  const url = `${BASE_URL()}/api/collection/backfill/worker?workerId=${encodeURIComponent(WORKER_ID)}`
  const res = await fetch(url, { headers: workerHeaders() })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`claim 실패: ${res.status} ${body}`)
  }
  const data = (await res.json()) as { job: ClaimedBackfillJob | null }
  return data.job ?? null
}

/** 잡 완료 보고. 실패해도 throw 없이 false 반환 (stale 상태는 운영자가 수동 정리). */
async function reportBackfillJob(params: {
  jobId: string
  status: 'DONE' | 'FAILED'
  collected?: number
  converted?: number
  duplicateRows?: number
  outboundCount?: number
  revenueSum?: number
  orderSum?: number
  salesQtySum?: number
  error?: string
}): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL()}/api/collection/backfill/worker`, {
      method: 'PATCH',
      headers: workerHeaders(),
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`[backfill-poller] 잡 보고 실패: ${res.status} ${body}`)
      return false
    }
    return true
  } catch (err) {
    console.warn(
      `[backfill-poller] 잡 보고 예외: ${err instanceof Error ? err.message : String(err)}`
    )
    return false
  }
}

/**
 * OUTBOUND 변환 체이닝 — coupang-sales-sync cron 엔드포인트 호출.
 * 반환값은 API가 처리한 모든 Space 의 created+updated 합산이다.
 * 단일 테넌트 배포에서는 곧 해당 워크스페이스 수치이지만,
 * 멀티 Space 환경에서는 다른 Space 변환 수치가 포함될 수 있다.
 */
type SalesSyncTotals = {
  converted: number
  revenue: number
  orderCount: number
  salesQty: number
}

async function chainSalesSync(fromDate: string, toDate: string): Promise<SalesSyncTotals> {
  // 120일 초과 시 범위 분할 (API 제한 준수)
  const dates = buildDateList(fromDate, toDate)
  const CHUNK = 120
  const acc: SalesSyncTotals = { converted: 0, revenue: 0, orderCount: 0, salesQty: 0 }

  for (let i = 0; i < dates.length; i += CHUNK) {
    const chunk = dates.slice(i, i + CHUNK)
    const from = chunk[chunk.length - 1] // oldest
    const to = chunk[0] // newest
    const url = `${BASE_URL()}/api/cron/coupang-sales-sync?from=${from}&to=${to}`

    try {
      const res = await fetch(url, { headers: { 'x-worker-api-key': WORKER_API_KEY() } })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.error(`[backfill-poller] 변환 API 실패: ${res.status} ${body}`)
        continue
      }
      const data = (await res.json()) as {
        totals?: { converted?: number; revenue?: number; orderCount?: number; salesQty?: number }
        spaces?: Array<{ created?: number; updated?: number }>
      }
      if (data.totals) {
        acc.converted += data.totals.converted ?? 0
        acc.revenue += data.totals.revenue ?? 0
        acc.orderCount += data.totals.orderCount ?? 0
        acc.salesQty += data.totals.salesQty ?? 0
      } else {
        // 구버전 API 폴백 — spaces 합산
        for (const space of data.spaces ?? []) {
          acc.converted += (space.created ?? 0) + (space.updated ?? 0)
        }
      }
    } catch (err) {
      console.error(
        `[backfill-poller] 변환 체이닝 예외: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return acc
}

/** fromDate(oldest)~toDate(newest) KST 날짜 목록 생성 (newest 순) */
function buildDateList(fromDate: string, toDate: string): string[] {
  const from = new Date(`${fromDate}T00:00:00+09:00`).getTime()
  const to = new Date(`${toDate}T00:00:00+09:00`).getTime()
  const out: string[] = []
  for (let t = to; t >= from; t -= 86400 * 1000) {
    out.push(new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10))
  }
  return out
}

// ─── 폴링 루프 ────────────────────────────────────────────────────────────────

export function startBackfillPoller(): void {
  setInterval(async () => {
    if (isProcessing) return

    let job: Awaited<ReturnType<typeof claimBackfillJob>> = null

    try {
      job = await claimBackfillJob()
    } catch (err) {
      // API 서버 미실행 등 — 조용히 무시
      return
    }

    if (!job) return

    console.log(
      `\n[backfill-poller] 잡 claim: ${job.id} (${job.days}일, workspace: ${job.workspaceId})`
    )
    isProcessing = true

    try {
      // 자격증명 복호화
      const password =
        job.credential.passwordIv === 'none'
          ? job.credential.encryptedPassword
          : decrypt(job.credential.encryptedPassword, job.credential.passwordIv)

      const creds: BackfillCreds = { loginId: job.credential.loginId, password }

      // Step 1: VENDOR 다운로드·업로드
      let result
      try {
        result = await runBackfill(
          job.days,
          creds,
          job.workspaceId,
          ({ date, succeeded, failed, total }) => {
            console.log(`[backfill-poller] 진행 ${succeeded + failed}/${total} — ${date}`)
          },
          // 날짜 루프 사이 잡 상태를 확인해 CANCELLED 면 조기 종료(사용자 취소).
          async () => (await fetchJobStatus(job.id)) === 'CANCELLED'
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[backfill-poller] runBackfill 실패: ${msg}`)
        await reportBackfillJob({ jobId: job.id, status: 'FAILED', error: msg })
        return
      }

      // 사용자 취소로 중단된 경우 — 잡은 이미 CANCELLED(app DELETE)라 보고하지 않는다.
      // (PATCH 는 RUNNING 이 아니면 409 라 DONE/FAILED 로 덮어쓰지 못함.)
      if (result.cancelled) {
        console.log(
          `[backfill-poller] 잡 취소됨: ${job.id} — 수집 ${result.succeeded}일까지 완료 후 중단`
        )
        return
      }

      console.log(
        `[backfill-poller] 수집 완료 — 성공: ${result.succeeded}일, 실패: ${result.failed}일, 삽입: ${result.totalInserted}건`
      )

      // Step 2: OUTBOUND 변환 체이닝
      let totals: SalesSyncTotals = { converted: 0, revenue: 0, orderCount: 0, salesQty: 0 }
      try {
        totals = await chainSalesSync(result.fromDate, result.toDate)
        console.log(
          `[backfill-poller] 변환 완료 — ${totals.converted}건 (매출 ${totals.revenue.toLocaleString()}원, 주문 ${totals.orderCount}, 판매량 ${totals.salesQty})`
        )
      } catch (err) {
        // 변환 실패는 전체 잡을 FAILED 처리하지 않음 (수집 성공은 보존)
        console.error(
          `[backfill-poller] 변환 체이닝 오류: ${err instanceof Error ? err.message : String(err)}`
        )
      }

      // Step 3: 잡 완료 보고
      // 한 일자도 못 모았으면 FAILED, 아니면 DONE(부분 수집 포함). aborted(브라우저
      // 사망 등 중단)여도 수집분이 있으면 DONE 으로 보존하고 원인은 error 에 남긴다.
      const finalStatus = result.succeeded === 0 ? 'FAILED' : 'DONE'
      const errorParts: string[] = []
      if (result.aborted && result.abortError) {
        errorParts.push(`중단(부분 수집): ${result.abortError}`)
      }
      if (result.failedDates.length > 0) {
        errorParts.push(`실패 날짜: ${result.failedDates.join(', ')}`)
      }
      await reportBackfillJob({
        jobId: job.id,
        status: finalStatus,
        collected: result.succeeded,
        converted: totals.converted,
        duplicateRows: result.totalDuplicate,
        outboundCount: totals.converted,
        revenueSum: totals.revenue,
        orderSum: totals.orderCount,
        salesQtySum: totals.salesQty,
        ...(errorParts.length > 0 && { error: errorParts.join(' / ') }),
      })

      // Step 4: 판매 수집 완료 Slack 알림 (DONE 만)
      if (finalStatus === 'DONE') {
        await notifyVendorSalesDone({
          mode: 'backfill',
          dateRange: `${result.fromDate} ~ ${result.toDate}`,
          collectedDays: result.succeeded,
          insertedRows: result.totalInserted,
          duplicateRows: result.totalDuplicate,
          outboundCount: totals.converted,
          revenue: totals.revenue,
          orderCount: totals.orderCount,
          salesQty: totals.salesQty,
        }).catch((err) => console.error('[slack] 판매 알림 전송 실패:', err))
      }

      console.log(`[backfill-poller] 잡 완료: ${job.id} → ${finalStatus}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[backfill-poller] 예상치 못한 오류: ${msg}`)
      await reportBackfillJob({ jobId: job.id, status: 'FAILED', error: msg })
    } finally {
      isProcessing = false
    }
  }, POLL_INTERVAL)

  console.log(`백필 잡 폴링 시작 (${POLL_INTERVAL / 1000}초 간격)`)
}
