import { prisma } from '@/lib/prisma'

type Row = {
  actorType: string
  actorId: string
  requesterUserId: string | null
  requesterSlackUserId: string | null
}

const SYSTEM_LABELS: Record<string, string> = {
  worker: '시스템(워커)',
  'workdeck-agent': '워크덱 에이전트',
}

/** 승인 UI·Slack 알림용 "행위자 · 요청자" 문자열. id(cuid)를 그대로 보여 주지 않는다. */
export async function describeActors(rows: Row[]): Promise<string[]> {
  const userIds = new Set<string>()
  const agentIds = new Set<string>()
  for (const r of rows) {
    // legacy(구버전 함수가 rolling deploy 중 쓴 행)는 actorId가 User면 구성원으로 본다.
    if (r.actorType === 'user' || r.actorType === 'legacy') userIds.add(r.actorId)
    if (r.actorType === 'agent' || r.actorType === 'integration') agentIds.add(r.actorId)
    if (r.requesterUserId) userIds.add(r.requesterUserId)
  }
  const [users, agents] = await Promise.all([
    userIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true },
        })
      : [],
    agentIds.size
      ? prisma.spaceAgent.findMany({
          where: { id: { in: [...agentIds] } },
          select: { id: true, name: true, kind: true },
        })
      : [],
  ])
  const userName = new Map(users.map((u) => [u.id, u.name ?? u.email]))
  const agentName = new Map(agents.map((a) => [a.id, a.name]))

  return rows.map((r) => {
    let actor: string
    if (r.actorType === 'user') actor = userName.get(r.actorId) ?? '구성원(알 수 없음)'
    else if (r.actorType === 'legacy')
      actor = userName.get(r.actorId) ?? SYSTEM_LABELS[r.actorId] ?? '시스템'
    else if (r.actorType === 'agent')
      actor = `에이전트 ${agentName.get(r.actorId) ?? '(알 수 없음)'}`
    else if (r.actorType === 'integration')
      actor = `연동 계정 ${agentName.get(r.actorId) ?? '(알 수 없음)'}`
    else actor = SYSTEM_LABELS[r.actorId] ?? '시스템'

    if (r.requesterUserId && r.requesterUserId !== r.actorId) {
      return `${actor} · 요청자 ${userName.get(r.requesterUserId) ?? '알 수 없음'}`
    }
    if (!r.requesterUserId && r.requesterSlackUserId) {
      return `${actor} · 요청자 미확인(Slack ${r.requesterSlackUserId})`
    }
    return actor
  })
}
