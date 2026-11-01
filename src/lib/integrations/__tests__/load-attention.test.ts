/** @jest-environment node */
import { loadIntegrationAttention } from '../load-attention'
import { prisma } from '@/lib/prisma'
import { listSecretMeta } from '@/lib/agent/secrets/store'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceAgent: { findMany: jest.fn() },
    coupangApiCredential: { findUnique: jest.fn() },
    collectionRun: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/agent/secrets/store', () => ({ listSecretMeta: jest.fn() }))
jest.mock('@/lib/inv/resolve-coupang-workspace', () => ({
  resolveSpaceCoupangWorkspaceId: jest.fn(async () => 'ws1'),
}))

const mock = prisma as unknown as {
  spaceAgent: { findMany: jest.Mock }
  coupangApiCredential: { findUnique: jest.Mock }
  collectionRun: { findFirst: jest.Mock }
}

describe('loadIntegrationAttention', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mock.coupangApiCredential.findUnique.mockResolvedValue({ updatedAt: new Date(0) })
    mock.collectionRun.findFirst.mockResolvedValue({
      status: 'COMPLETED',
      error: null,
      probeResult: { ok: false, ipBlocked: true },
    })
    mock.spaceAgent.findMany.mockResolvedValue([])
    ;(listSecretMeta as jest.Mock).mockResolvedValue([])
  })

  it('요약 하나가 실패해도 나머지를 돌려준다', async () => {
    mock.spaceAgent.findMany.mockRejectedValue(new Error('timeout'))
    ;(listSecretMeta as jest.Mock).mockRejectedValue(new Error('timeout'))
    const items = await loadIntegrationAttention('s1', 'u1')
    expect(items.map((i) => i.cardId)).toEqual(['coupang'])
  })

  it('자격증명 저장 이후의 연결 테스트만 본다', async () => {
    const updatedAt = new Date('2026-11-01')
    mock.coupangApiCredential.findUnique.mockResolvedValue({ updatedAt })
    await loadIntegrationAttention('s1', 'u1')
    expect(mock.collectionRun.findFirst.mock.lastCall?.[0].where.createdAt).toEqual({
      gt: updatedAt,
    })
  })
})
