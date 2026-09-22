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
}): string {
  const total = args.results.length
  const failed = args.results.filter((r) => !r.ok)

  if (failed.length === 0) {
    return `✅ 쿠팡 판매가 반영 완료 — ${total}건 중 ${total}건 반영`
  }

  const head =
    args.status === 'FAILED'
      ? `❌ 쿠팡 판매가 반영 실패 — ${total}건 전부 실패`
      : `⚠️ 쿠팡 판매가 부분 반영 — ${total}건 중 ${failed.length}건 실패`

  const lines = failed.map((r) => `• ${r.listingName}: ${r.error ?? '알 수 없는 오류'}`)
  return [head, ...lines].join('\n')
}

export async function notifyWriteJobResult(jobId: string): Promise<void> {
  try {
    const job = await prisma.coupangWriteJob.findUnique({
      where: { id: jobId },
      select: { actionId: true, status: true, results: true, spaceId: true },
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
