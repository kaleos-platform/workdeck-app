// @jest-environment node
import { checkAndIncrementUsage } from '../llm/usage'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentLlmUsage: {
      aggregate: jest.fn(),
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

const mockPrisma = prisma as unknown as {
  agentLlmUsage: {
    aggregate: jest.Mock
    upsert: jest.Mock
    findUnique: jest.Mock
    update: jest.Mock
  }
}

describe('checkAndIncrementUsage — 일일 한도', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.WORKDECK_AGENT_DAILY_LIMIT
    delete process.env.WORKDECK_AGENT_GLOBAL_DAILY_LIMIT
    // 기본: 전역/Space 카운트 0, upsert·update 무해.
    mockPrisma.agentLlmUsage.aggregate.mockResolvedValue({ _sum: { requestCount: 0 } })
    mockPrisma.agentLlmUsage.upsert.mockResolvedValue({})
    mockPrisma.agentLlmUsage.findUnique.mockResolvedValue({ requestCount: 0 })
    mockPrisma.agentLlmUsage.update.mockResolvedValue({})
  })

  test('한도 이하 → allowed:true + requestCount 증가', async () => {
    const r = await checkAndIncrementUsage('space-1')
    expect(r.allowed).toBe(true)
    expect(mockPrisma.agentLlmUsage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { requestCount: { increment: 1 } } })
    )
  })

  test('Space 일일 한도 도달 → allowed:false, 증가 없음', async () => {
    process.env.WORKDECK_AGENT_DAILY_LIMIT = '50'
    mockPrisma.agentLlmUsage.findUnique.mockResolvedValue({ requestCount: 50 })
    const r = await checkAndIncrementUsage('space-1')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBeTruthy()
    expect(mockPrisma.agentLlmUsage.update).not.toHaveBeenCalled()
  })

  test('전역 일일 한도 초과 → allowed:false (Space 조회 전 차단)', async () => {
    process.env.WORKDECK_AGENT_GLOBAL_DAILY_LIMIT = '500'
    mockPrisma.agentLlmUsage.aggregate.mockResolvedValue({ _sum: { requestCount: 500 } })
    const r = await checkAndIncrementUsage('space-1')
    expect(r.allowed).toBe(false)
    // 전역 차단이므로 Space upsert/update 미실행.
    expect(mockPrisma.agentLlmUsage.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.agentLlmUsage.update).not.toHaveBeenCalled()
  })

  test('env 오버라이드 — Space 한도 2로 낮추면 count 2에서 차단', async () => {
    process.env.WORKDECK_AGENT_DAILY_LIMIT = '2'
    mockPrisma.agentLlmUsage.findUnique.mockResolvedValue({ requestCount: 2 })
    const r = await checkAndIncrementUsage('space-1')
    expect(r.allowed).toBe(false)
  })
})
