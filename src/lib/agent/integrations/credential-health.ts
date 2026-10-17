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
const CONCURRENCY = 4

// 공급자별 가벼운 점검 — 데이터는 읽지 않고 토큰이 살아 있는지만 본다. 복호화한 id는 audit 에 남긴다.
const PROBES: Record<string, (spaceId: string, audit: string[]) => Promise<void>> = {
  [META]: async (spaceId, audit) => {
    const cred = await loadMetaCred(spaceId, audit)
    await fetchAdAccountCurrencies(cred.secret, cred.config) // 매핑된 광고 계정 조회(통화)
  },
  [GOOGLE]: async (spaceId, audit) => {
    await verifyGoogleCred(await loadGoogleCred(spaceId, audit))
  },
}

// Slack mrkdwn 제어 문자 — 공급자 오류 문구가 멘션·링크로 렌더링되지 않게.
const escapeMrkdwn = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Row = {
  id: string
  spaceId: string
  provider: string
  lastError: string | null
  healthError: string | null
  healthAlertedAt: Date | null
}

export type HealthResult = {
  checked: number
  failed: number
  notified: number
  errors: number
  decryptedCredentialIds: string[]
}

/**
 * 매일 cron — 모든 Space 의 Meta·Google 자격증명을 점검한다.
 * 알림 전이는 점검 전용 상태(healthError·healthAlertedAt)로만 판단한다. lastError 는 다른 경로(실행·조회 오류)도 쓰는 진단용이라 쓰지 않는다.
 * - 실패: 아직 알리지 않았으면(healthAlertedAt 없음) 알리고, 보냈을 때만 healthAlertedAt 을 남긴다(채널이 생기면 다음 날 다시 시도).
 * - 성공: 장애를 알렸던 상태면 '복구'를 알린다. 이 점검이 남긴 lastError 만 지운다.
 */
export async function checkCredentialHealth(): Promise<HealthResult> {
  const rows: Row[] = await prisma.spaceCredential.findMany({
    where: { provider: { in: Object.keys(PROBES) } },
    select: {
      id: true,
      spaceId: true,
      provider: true,
      lastError: true,
      healthError: true,
      healthAlertedAt: true,
    },
  })
  const out: HealthResult = {
    checked: 0,
    failed: 0,
    notified: 0,
    errors: 0,
    decryptedCredentialIds: [],
  }
  const queue = [...rows]
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        await checkOne(row, out)
      } catch (err) {
        // 한 행의 DB·알림 실패가 다른 Space 점검을 막지 않는다.
        out.errors++
        console.error(
          '[credential-health] 행 처리 실패',
          row.id,
          err instanceof Error ? err.message : err
        )
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker))
  return out
}

async function checkOne(row: Row, out: HealthResult): Promise<void> {
  out.checked++
  const label = LABEL[row.provider] ?? row.provider
  let error: string | null = null
  try {
    await PROBES[row.provider](row.spaceId, out.decryptedCredentialIds)
  } catch (err) {
    error = maskSecrets(err instanceof Error ? err.message : String(err)).slice(0, 500)
  }

  if (error) {
    out.failed++
    let alertedAt = row.healthAlertedAt
    if (!alertedAt) {
      const sent = await sendSpaceNotification({
        spaceId: row.spaceId,
        text: `:warning: ${label} 연동 점검 실패: ${escapeMrkdwn(error)}\n연동 설정에서 토큰을 확인하세요. 조회·제안·일일 보고가 멈출 수 있습니다.`,
      })
      if (sent) {
        out.notified++
        alertedAt = new Date()
      }
    }
    await prisma.spaceCredential.update({
      where: { id: row.id },
      data: { healthError: error, healthAlertedAt: alertedAt, lastError: error },
    })
    return
  }

  if (row.healthAlertedAt) {
    const sent = await sendSpaceNotification({
      spaceId: row.spaceId,
      text: `:white_check_mark: ${label} 연동이 복구되었습니다.`,
    })
    if (sent) out.notified++
  }
  await prisma.spaceCredential.update({
    where: { id: row.id },
    data: {
      healthError: null,
      healthAlertedAt: null,
      lastVerifiedAt: new Date(),
      // 이 점검이 남긴 오류일 때만 지운다(다른 경로의 진단 기록은 남긴다).
      ...(row.healthError && row.lastError === row.healthError ? { lastError: null } : {}),
    },
  })
}
