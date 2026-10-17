import { prisma } from '@/lib/prisma'
import { maskSecrets } from '@/lib/agent/audit'
import { sendSpaceNotification } from '@/lib/slack/send-notification'
import {
  PROVIDER as META,
  fetchAdAccountCurrencies,
  loadMetaCred,
} from '@/lib/agent/integrations/meta-ads'
import {
  PROVIDER as GOOGLE,
  loadGoogleCred,
  verifyGoogleCred,
} from '@/lib/agent/integrations/google-marketing'

const LABEL: Record<string, string> = { [META]: 'Meta 광고', [GOOGLE]: 'Google 마케팅' }

// 공급자별 가벼운 점검 — 데이터는 읽지 않고 토큰이 살아 있는지만 본다.
const PROBES: Record<string, (spaceId: string) => Promise<void>> = {
  [META]: async (spaceId) => {
    const cred = await loadMetaCred(spaceId, [])
    await fetchAdAccountCurrencies(cred.secret, cred.config) // 매핑된 광고 계정 조회(통화)
  },
  [GOOGLE]: async (spaceId) => {
    await verifyGoogleCred(await loadGoogleCred(spaceId, []))
  },
}

export type HealthResult = { checked: number; failed: number; notified: number }

/**
 * 매일 cron — 모든 Space 의 Meta·Google 자격증명을 점검한다.
 * 실패면 lastError 를 남기고, 정상→오류로 바뀐 때만 그 Space 알림 채널에 한 번 알린다. 오류→정상이면 '복구'를 한 번 알린다.
 */
export async function checkCredentialHealth(): Promise<HealthResult> {
  const rows = await prisma.spaceCredential.findMany({
    where: { provider: { in: Object.keys(PROBES) } },
    select: { id: true, spaceId: true, provider: true, lastError: true },
  })
  const out: HealthResult = { checked: 0, failed: 0, notified: 0 }
  for (const row of rows) {
    out.checked++
    const label = LABEL[row.provider] ?? row.provider
    let error: string | null = null
    try {
      await PROBES[row.provider](row.spaceId)
    } catch (err) {
      error = maskSecrets(err instanceof Error ? err.message : String(err)).slice(0, 500)
    }
    if (error) {
      out.failed++
      await prisma.spaceCredential.update({ where: { id: row.id }, data: { lastError: error } })
      if (!row.lastError) {
        const sent = await sendSpaceNotification({
          spaceId: row.spaceId,
          text: `:warning: ${label} 연동 점검 실패: ${error}\n연동 설정에서 토큰을 확인하세요. 조회·제안·일일 보고가 멈출 수 있습니다.`,
        })
        if (sent) out.notified++
      }
    } else {
      await prisma.spaceCredential.update({
        where: { id: row.id },
        data: { lastError: null, lastVerifiedAt: new Date() },
      })
      if (row.lastError) {
        const sent = await sendSpaceNotification({
          spaceId: row.spaceId,
          text: `:white_check_mark: ${label} 연동이 복구되었습니다.`,
        })
        if (sent) out.notified++
      }
    }
  }
  return out
}
