/**
 * 쓰기 잡 결과를 승인 알림 메시지의 **스레드 답글**로 보낸다.
 *
 * 규약: 모든 실패는 삼키고 console.error 만 남긴다(notify-pending-action.ts 와 동일).
 * IP 거부는 여기서 다루지 않는다 — 액션 하나의 문제가 아니라 전 스코프가
 * 동시에 죽은 상황이라 기존 IP 거부 알림 경로로 따로 나간다.
 */
import { prisma } from '@/lib/prisma'
import { decryptBotToken } from './token-crypto'
import { postMessage } from './client'

export type ResultLine = { listingName: string; ok: boolean; error: string | null }

export function buildResultText(args: {
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
  results: ResultLine[]
  error?: string | null
}): string {
  const total = args.results.length
  const failed = args.results.filter((r) => !r.ok)
  const lines = failed.map((r) => `• ${r.listingName}: ${r.error ?? '알 수 없는 오류'}`)

  // status 를 먼저 본다. 워커가 타깃 루프에 들어가기도 전에 죽으면 results 가 비어 있는데,
  // failed.length===0 만 보면 "0건 중 0건 반영 ✅" 이라는 거짓 성공이 스레드에 남는다.
  if (args.status === 'FAILED') {
    const head =
      total === 0
        ? `❌ 쿠팡 판매가 반영 실패 — ${args.error ?? '워커 실행 중 중단'}`
        : `❌ 쿠팡 판매가 반영 실패 — ${total}건 전부 실패`
    return [head, ...lines].join('\n')
  }

  if (failed.length > 0) {
    return [`⚠️ 쿠팡 판매가 부분 반영 — ${total}건 중 ${failed.length}건 실패`, ...lines].join('\n')
  }

  // 성공으로 보고됐는데 대상이 0건이면 반영된 것이 없다 — 성공 문구를 쓰지 않는다.
  if (total === 0) {
    return `⚠️ 쿠팡 판매가 반영 결과 없음 — ${args.error ?? '반영된 대상이 없습니다'}`
  }

  return `✅ 쿠팡 판매가 반영 완료 — ${total}건 중 ${total}건 반영`
}

export async function notifyWriteJobResult(jobId: string): Promise<void> {
  try {
    const job = await prisma.coupangWriteJob.findUnique({
      where: { id: jobId },
      select: { actionId: true, status: true, results: true, error: true, spaceId: true },
    })
    if (!job?.actionId) return // PRODUCT_SYNC 등 승인과 무관한 잡

    const action = await prisma.agentPendingAction.findUnique({
      where: { id: job.actionId },
      select: { slackChannelId: true, slackMessageTs: true, payload: true },
    })
    // Slack 미연동 space, 또는 원본 승인 메시지가 없으면 조용히 건너뛴다.
    if (!action?.slackChannelId || !action.slackMessageTs) return

    const payload = action.payload as {
      targets?: Array<{ listingId: string; listingName: string }>
    }
    const nameOf = (listingId: string) =>
      payload.targets?.find((t) => t.listingId === listingId)?.listingName ?? listingId

    const raw = (job.results ?? []) as Array<{
      listingId: string
      ok: boolean
      error: string | null
    }>
    const text = buildResultText({
      status: job.status as 'SUCCEEDED' | 'PARTIAL' | 'FAILED',
      results: raw.map((r) => ({ listingName: nameOf(r.listingId), ok: r.ok, error: r.error })),
      error: job.error,
    })

    const installation = await prisma.slackInstallation.findUnique({
      where: { spaceId: job.spaceId },
      select: { botToken: true, botTokenIv: true },
    })
    if (!installation) return

    const token = decryptBotToken(installation.botToken, installation.botTokenIv)
    const res = await postMessage(token, {
      channel: action.slackChannelId,
      text,
      thread_ts: action.slackMessageTs,
    })
    if (!res.ok) {
      console.error(`[slack] 쓰기 결과 알림 전송 실패: ${res.error}`)
    }
  } catch (err) {
    console.error('[notify-write-job-result] 알림 실패:', err)
  }
}
