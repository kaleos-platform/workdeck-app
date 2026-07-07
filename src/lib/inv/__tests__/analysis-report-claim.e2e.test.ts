/**
 * POST /api/analysis/reports/[reportId]/run — 동시 요청 claim 원자성 e2e.
 *
 * PENDING 리포트에 두 요청이 동시에 도달하면 정확히 하나만 claim 성공(200)하고
 * 나머지는 404를 받아야 한다. DB에서 PROCESSING 전환도 정확히 1회만 발생해야 한다.
 * resolveWorkerAuth mock + buildAnalysisContext/getSystemPrompt mock. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

// resolveWorkerAuth만 mock, errorResponse는 실제 사용
jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { __esModule: true, ...actual, resolveWorkerAuth: jest.fn() }
})

// buildAnalysisContext — DB 의존 최소화를 위해 mock
jest.mock('@/lib/analysis/data-builder', () => ({
  __esModule: true,
  buildAnalysisContext: jest.fn(),
}))

// getSystemPrompt mock
jest.mock('@/lib/ai/prompts', () => ({
  __esModule: true,
  getSystemPrompt: jest.fn(),
}))

import { resolveWorkerAuth } from '@/lib/api-helpers'
import { buildAnalysisContext } from '@/lib/analysis/data-builder'
import { getSystemPrompt } from '@/lib/ai/prompts'
import { POST } from '../../../../app/api/analysis/reports/[reportId]/run/route'

const WS_ID = 'e2e00000-0000-4000-8000-0000000000a1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000a2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let reportId = ''

async function cleanup() {
  // AnalysisReport는 Workspace onDelete: Cascade
  await prisma.workspace.deleteMany({ where: { id: WS_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

function makePostReq(rId: string) {
  return new NextRequest(`http://localhost/api/analysis/reports/${rId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-worker-api-key': 'test-key' },
  })
}

d('POST /analysis/reports/[reportId]/run — 동시 claim 원자성 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    // throwaway User + Workspace 시드
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-claim@throwaway.test' } })
    await prisma.workspace.create({ data: { id: WS_ID, ownerId: USER_ID, name: 'E2E Claim' } })

    // PENDING AnalysisReport 시드 (필수 필드 모두 포함)
    const report = await prisma.analysisReport.create({
      data: {
        workspaceId: WS_ID,
        periodStart: new Date('2026-07-01T00:00:00Z'),
        periodEnd: new Date('2026-07-07T23:59:59Z'),
        reportType: 'DAILY_REVIEW',
        summary: '',
        suggestions: [],
        status: 'PENDING',
      },
    })
    reportId = report.id

    // 워커 인증 항상 통과
    ;(resolveWorkerAuth as jest.Mock).mockReturnValue({ authenticated: true as const })

    // buildAnalysisContext — 최소 응답 반환
    ;(buildAnalysisContext as jest.Mock).mockResolvedValue({
      campaigns: [],
      inefficientKeywords: [],
      removedKeywords: [],
      removedProducts: [],
      campaignTargets: [],
      recentMemos: [],
      campaignMetas: [],
      activeRules: [],
      periodStart: new Date('2026-07-01T00:00:00Z'),
      periodEnd: new Date('2026-07-07T23:59:59Z'),
      reportType: 'DAILY_REVIEW',
    })

    // getSystemPrompt — 빈 문자열 반환
    ;(getSystemPrompt as jest.Mock).mockReturnValue('')
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('동시 두 요청 중 정확히 하나만 200, 나머지 하나는 404 — DB PROCESSING 1회 전환', async () => {
    // 두 요청을 동시에 실행
    const params = Promise.resolve({ reportId })
    const results = await Promise.all([
      POST(makePostReq(reportId), { params }),
      POST(makePostReq(reportId), { params }),
    ])
    const [res1, res2] = results as [{ status: number }, { status: number }]

    const statuses = [res1.status, res2.status].sort((a, b) => a - b)

    // 정확히 하나만 200, 하나는 404
    expect(statuses).toEqual([200, 404])

    // DB 상태: PROCESSING 1회만 전환
    const report = await prisma.analysisReport.findUnique({ where: { id: reportId } })
    expect(report?.status).toBe('PROCESSING')
  })
})
