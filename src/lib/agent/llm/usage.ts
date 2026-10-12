import { prisma } from '@/lib/prisma'
import type { Actor } from '@/lib/agent/identity/principal'

/**
 * LLM 사용량 rate limit — Space별 일일 요청 수 + 전역 일일 요청 수 상한.
 *
 * 한도(env 오버라이드):
 *  - WORKDECK_AGENT_DAILY_LIMIT (기본 50): Space당 하루 LLM 요청 수.
 *  - WORKDECK_AGENT_GLOBAL_DAILY_LIMIT (기본 500): 전 Space 합산 하루 요청 수.
 *
 * date는 KST "YYYY-MM-DD" (Vercel UTC 서버에서 자정~09시 밀림 방지 위해 +9h 후 UTC getter).
 */

/** 현재 KST 기준 "YYYY-MM-DD". */
export function todayKst(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function spaceDailyLimit(): number {
  const raw = Number(process.env.WORKDECK_AGENT_DAILY_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? raw : 50
}

function globalDailyLimit(): number {
  const raw = Number(process.env.WORKDECK_AGENT_GLOBAL_DAILY_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? raw : 500
}

export interface UsageCheckResult {
  allowed: boolean
  reason?: string
}

/**
 * LLM 요청 1건을 소비 시도한다. 한도 이하면 requestCount를 원자적으로 증가시키고 allowed:true.
 * 초과면 증가시키지 않고 allowed:false + 한국어 사유.
 *
 * 순서: ①전역 합계 확인 → ②Space upsert(0행 보장) → ③Space 한도 확인 → ④atomic increment.
 * (증가를 마지막에 두어, 한도 초과 시 카운트가 오르지 않도록 한다.)
 */
export async function checkAndIncrementUsage(spaceId: string): Promise<UsageCheckResult> {
  const date = todayKst()

  // ① 전역 일일 합계
  const globalAgg = await prisma.agentLlmUsage.aggregate({
    where: { date },
    _sum: { requestCount: true },
  })
  const globalCount = globalAgg._sum.requestCount ?? 0
  if (globalCount >= globalDailyLimit()) {
    return {
      allowed: false,
      reason: '오늘 전체 AI 응답 한도에 도달했습니다. 잠시 후 다시 시도해주세요.',
    }
  }

  // ② 오늘 Space 행 보장(없으면 0으로 생성)
  await prisma.agentLlmUsage.upsert({
    where: { spaceId_date: { spaceId, date } },
    create: { spaceId, date },
    update: {},
  })

  // ③ Space 일일 한도
  const row = await prisma.agentLlmUsage.findUnique({
    where: { spaceId_date: { spaceId, date } },
    select: { requestCount: true },
  })
  if ((row?.requestCount ?? 0) >= spaceDailyLimit()) {
    return {
      allowed: false,
      reason:
        '오늘 이 워크스페이스의 AI 응답 한도에 도달했습니다. 정형 명령(도움말)은 계속 사용할 수 있습니다.',
    }
  }

  // ④ 요청 수 원자적 증가
  await prisma.agentLlmUsage.update({
    where: { spaceId_date: { spaceId, date } },
    data: { requestCount: { increment: 1 } },
  })

  return { allowed: true }
}

export interface UsageMeta {
  model: string
  actor: Actor
  requesterUserId: string | null
  workId: string
}

/** 응답의 실제 토큰 사용량을 오늘 집계(rate limit용)와 UsageEvent(행위자별 기록)에 반영한다. */
export async function recordTokens(
  spaceId: string,
  inputTokens: number,
  outputTokens: number,
  meta: UsageMeta
): Promise<void> {
  const date = todayKst()
  await prisma.agentLlmUsage.upsert({
    where: { spaceId_date: { spaceId, date } },
    create: { spaceId, date, inputTokens, outputTokens },
    update: {
      inputTokens: { increment: inputTokens },
      outputTokens: { increment: outputTokens },
    },
  })
  // 행위자별 기록 실패가 LLM 응답을 막지 않도록 로그만 남긴다.
  try {
    await prisma.usageEvent.create({
      data: {
        spaceId,
        source: 'workdeck',
        provider: 'anthropic',
        planClass: 'payg',
        model: meta.model,
        actorType: meta.actor.type,
        actorId: meta.actor.id,
        requesterUserId: meta.requesterUserId,
        inputTokens,
        outputTokens,
        workId: meta.workId,
      },
    })
  } catch (err) {
    console.error(`[agent] UsageEvent 기록 실패 (spaceId=${spaceId}):`, err)
  }
}
