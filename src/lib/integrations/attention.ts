// 연동 설정의 "확인 필요" 판정 — 클라이언트도 쓰므로 DB 조회는 load-attention.ts에 둔다.

export type IntegrationTab = 'services' | 'agents' | 'secrets'
export type AttentionCardId = 'coupang' | 'agent-tokens' | 'space-secrets'
export type AttentionItem = { tab: IntegrationTab; cardId: AttentionCardId; message: string }

const DAY_MS = 86_400_000
const EXPIRY_WARNING_DAYS = 7

export function isExpiringSoon(expiresAt: Date | string, now = new Date()) {
  return new Date(expiresAt).getTime() - now.getTime() <= EXPIRY_WARNING_DAYS * DAY_MS
}

/** 에이전트의 토큰(폐기 제외)이 경고 대상이면 가장 늦은 만료일을 준다. 새 토큰으로 교체한 뒤 남은 옛 토큰은 경고하지 않는다. */
export function flaggedTokenExpiry(
  tokens: { expiresAt: Date | string | null }[],
  now = new Date()
) {
  if (tokens.length === 0 || tokens.some((t) => t.expiresAt === null)) return null
  const latest = new Date(Math.max(...tokens.map((t) => new Date(t.expiresAt!).getTime())))
  return isExpiringSoon(latest, now) ? latest : null
}

/** 마지막 연결 테스트가 실패했으면 사유를 준다. 성공이나 결과 없음은 null. */
export function coupangProbeError(run: {
  status: string
  error: string | null
  probeResult: unknown
}) {
  // 워커는 실패한 테스트를 FAILED + probeResult로 남긴다 — 사유가 든 probeResult를 먼저 본다.
  const result = run.probeResult as { ok?: boolean; ipBlocked?: boolean; message?: string } | null
  if (!result) return run.status === 'FAILED' ? (run.error ?? '연결 테스트 실패') : null
  if (result.ok) return null
  return result.ipBlocked
    ? '워커 IP가 Wing 허용목록에 없음'
    : (result.message ?? '연결 테스트 실패')
}

function expiryLabel(expiresAt: Date, now: Date) {
  const ms = expiresAt.getTime() - now.getTime()
  return ms <= 0 ? '만료' : `${Math.ceil(ms / DAY_MS)}일 뒤 만료`
}

/** 쿠팡 오류 → 토큰 → 비밀값 순. 첫 항목의 탭이 처음 열리는 탭이다. */
export function buildAttention(input: {
  coupangError: string | null
  // 켜진 에이전트의 폐기되지 않은 토큰만 넘긴다.
  agents: { name: string; tokens: { expiresAt: Date | null }[] }[]
  envSecrets: { name: string; expiresAt: Date }[]
  now?: Date
}): AttentionItem[] {
  const now = input.now ?? new Date()
  const items: AttentionItem[] = []

  if (input.coupangError) {
    items.push({
      tab: 'services',
      cardId: 'coupang',
      message: `쿠팡 Open API — ${input.coupangError}`,
    })
  }

  for (const agent of input.agents) {
    const latest = flaggedTokenExpiry(agent.tokens, now)
    if (latest) {
      items.push({
        tab: 'agents',
        cardId: 'agent-tokens',
        message: `토큰 ${expiryLabel(latest, now)} — ${agent.name}`,
      })
    }
  }

  for (const secret of input.envSecrets) {
    if (isExpiringSoon(secret.expiresAt, now)) {
      items.push({
        tab: 'secrets',
        cardId: 'space-secrets',
        message: `비밀값 ${expiryLabel(secret.expiresAt, now)} — ${secret.name}`,
      })
    }
  }

  return items
}
