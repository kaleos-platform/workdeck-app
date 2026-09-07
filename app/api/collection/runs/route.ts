import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { queryCollectionRuns } from '@/lib/coupang-ads/queries'
import { canWorkspaceCollect } from '@/lib/billing/entitlement'

// GET /api/collection/runs — 수집 실행 이력 조회
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // 페이지네이션 파라미터
  const url = new URL(request.url)
  const limit = Number(url.searchParams.get('limit')) || 20
  const cursor = url.searchParams.get('cursor')

  return NextResponse.json(await queryCollectionRuns(workspace.id, { limit, cursor }))
}

// POST /api/collection/runs — 수집 트리거 (사용자 세션 OR Worker 인증)
export async function POST(request: NextRequest) {
  // Worker 인증 시 body에서 workspaceId + triggeredBy 읽기
  const workerKey = request.headers.get('x-worker-api-key')
  const expectedKey = process.env.WORKER_API_KEY
  const isWorker = Boolean(workerKey && expectedKey && workerKey === expectedKey)

  let workspaceId: string
  let triggeredBy = 'manual'

  if (isWorker) {
    const body = await request.json().catch(() => ({}))
    if (!body.workspaceId) {
      // Worker가 workspaceId 없이 호출 시 첫 번째 활성 자격증명의 workspace 사용
      const cred = await prisma.coupangCredential.findFirst({
        where: { isActive: true },
        select: { workspaceId: true },
      })
      if (!cred) return errorResponse('활성 워크스페이스가 없습니다', 404)
      workspaceId = cred.workspaceId
    } else {
      workspaceId = body.workspaceId
    }
    triggeredBy = body.triggeredBy ?? 'scheduled'
  } else {
    const resolved = await resolveWorkspace()
    if ('error' in resolved) return resolved.error
    workspaceId = resolved.workspace.id
  }

  const workspace = { id: workspaceId }

  // 수동 수집 작업 스코프 — 사용자(비-worker) 요청에서만 받는다. 미지정/worker(자동)는
  // 둘 다 true(전체 수집, 현행 유지). 판매(VENDOR)는 수동에서 항상 제외(워커가 보장).
  let collectAds = true
  let collectInventory = true
  let probeApi = false
  if (!isWorker) {
    const scopeBody = await request.json().catch(() => ({}) as Record<string, unknown>)
    if (typeof scopeBody.collectAds === 'boolean') collectAds = scopeBody.collectAds
    if (typeof scopeBody.collectInventory === 'boolean')
      collectInventory = scopeBody.collectInventory
    if (typeof scopeBody.probeApi === 'boolean') probeApi = scopeBody.probeApi
    // probe run(연결 테스트)은 실제 수집이 아니라 API 자격·IP allowlist 확인용이라
    // collectAds/collectInventory 스코프 검사에서 제외한다.
    if (!probeApi && !collectAds && !collectInventory) {
      return errorResponse('최소 한 가지 작업을 선택해야 합니다', 422)
    }
  }

  // 자격증명 존재 확인 — probe run은 CoupangCredential(크롤링 로그인)이 아니라
  // CoupangApiCredential을 쓰므로 이 검사를 건너뛴다. API 자격 유효성은
  // runApiProbe()(worker/src/orchestrator.ts)가 직접 확인한다.
  if (!probeApi) {
    const credential = await prisma.coupangCredential.findUnique({
      where: { workspaceId: workspace.id },
      select: { id: true, isActive: true },
    })
    if (!credential || !credential.isActive) {
      return errorResponse('쿠팡 자격증명이 설정되지 않았거나 비활성 상태입니다', 400)
    }
  }

  // 결제 entitlement 게이트: 만료/미구독 Space는 수집(수동+자동) 차단
  if (!(await canWorkspaceCollect(workspace.id))) {
    return errorResponse('coupang-ads 구독이 만료되어 수집을 시작할 수 없습니다', 402)
  }

  // 이미 진행 중인 실행이 있는지 확인 — probe run은 실제 수집(광고/재고 크롤링)과
  // 동시에 돌 수 있어야 하므로 이 중복 검사에서 제외한다. 그렇지 않으면 일일 수집이
  // 도는 동안 연결 테스트를 못 하고, 반대로 probe가 떠 있으면 실제 수집이 막힌다.
  // probe끼리의 중복만 별도로 막는다.
  const activeRun = await prisma.collectionRun.findFirst({
    where: {
      workspaceId: workspace.id,
      status: { in: ['PENDING', 'RUNNING', 'DOWNLOADING', 'PARSING'] },
      probeApi,
    },
  })
  if (activeRun) {
    return errorResponse('이미 진행 중인 수집 작업이 있습니다', 409)
  }

  // 새 수집 실행 생성
  const status = isWorker ? 'RUNNING' : 'PENDING' // Worker는 직접 실행, UI는 Worker 폴링 대기
  const run = await prisma.collectionRun.create({
    data: {
      workspaceId: workspace.id,
      triggeredBy,
      status,
      collectAds,
      collectInventory,
      probeApi,
      ...(isWorker && { startedAt: new Date() }),
    },
  })

  return NextResponse.json({ run }, { status: 201 })
}
