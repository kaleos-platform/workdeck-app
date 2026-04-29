// Phase 2 Unit 14 — INSIGHT_SWEEP job 을 처리하는 워커 핸들러.
// 실행 경로:
//   1) 웹앱 API `/api/sc/jobs/worker` 에서 INSIGHT_SWEEP job 클레임
//    2) 이 핸들러가 공간 id 를 추출해 `/api/sc/insights/generate` 를 호출
//   3) 결과를 /api/sc/jobs/[id]/complete 로 리포트
//
// 설계 메모: AI 호출은 웹앱 측에서 (Prisma + provider factory 재사용) 수행.
// 워커는 단순 트리거로 동작해 코드 중복과 prisma 초기화 이슈를 회피한다.

type SweepJobPayload = {
  sinceDays?: number
  maxProposals?: number
}

type ClaimedJob = {
  job: {
    id: string
    spaceId?: string
    kind: 'PUBLISH' | 'COLLECT_METRIC' | 'INSIGHT_SWEEP'
    targetId: string | null
    payload: unknown
    attempts: number
  }
}

export type InsightSweepResult = {
  ok: boolean
  errorMessage?: string
  meta?: { createdRules?: number; bucketCount?: number; skippedReason?: string }
}

const WEB_APP_URL = process.env.WEB_APP_URL ?? 'http://127.0.0.1:3000'
const WORKER_API_KEY = process.env.WORKER_API_KEY

export async function handleInsightSweep(c: ClaimedJob): Promise<InsightSweepResult> {
  if (!WORKER_API_KEY) {
    return { ok: false, errorMessage: 'WORKER_API_KEY 환경변수가 필요합니다' }
  }

  const spaceId =
    typeof c.job.spaceId === 'string'
      ? c.job.spaceId
      : typeof c.job.targetId === 'string'
        ? c.job.targetId
        : null
  if (!spaceId) {
    return { ok: false, errorMessage: 'spaceId 없는 INSIGHT_SWEEP job — payload 확인 필요' }
  }

  const payload = (c.job.payload ?? {}) as SweepJobPayload
  const body = {
    sinceDays: payload.sinceDays ?? 30,
    maxProposals: payload.maxProposals ?? 5,
  }

  const res = await fetch(`${WEB_APP_URL}/api/sc/insights/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-api-key': WORKER_API_KEY,
      'x-workspace-id': spaceId, // worker 인증 경로에서 spaceId 주입 힌트
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, errorMessage: `insight API 호출 실패: ${res.status} ${text}` }
  }

  const data = (await res.json().catch(() => ({}))) as {
    createdRules?: number
    bucketCount?: number
    skippedReason?: string
  }

  return {
    ok: true,
    meta: {
      createdRules: data.createdRules,
      bucketCount: data.bucketCount,
      skippedReason: data.skippedReason,
    },
  }
}
