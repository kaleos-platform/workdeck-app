/** @jest-environment node */
import { loadIntegrationStatuses } from '../load-status'
import { loadIntegrationAttention } from '../load-attention'
import { prisma } from '@/lib/prisma'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    slackInstallation: { findUnique: jest.fn() },
    spaceCredential: { findMany: jest.fn() },
    scNotionConnection: { findUnique: jest.fn() },
    scDriveConnection: { findUnique: jest.fn() },
    spaceAgentSetting: { findUnique: jest.fn() },
    spaceAgent: { count: jest.fn() },
    spaceSecret: { count: jest.fn() },
    coupangApiCredential: { findUnique: jest.fn() },
    coupangCredential: { findUnique: jest.fn() },
  },
}))
jest.mock('../load-attention', () => ({ loadIntegrationAttention: jest.fn() }))
jest.mock('@/lib/inv/resolve-coupang-workspace', () => ({
  resolveSpaceCoupangWorkspaceId: jest.fn(async () => 'ws1'),
}))

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>
const adminOnlyCalls = () => [
  db.spaceAgent.count,
  db.spaceSecret.count,
  db.coupangApiCredential.findUnique,
  db.coupangCredential.findUnique,
  loadIntegrationAttention as jest.Mock,
]

describe('loadIntegrationStatuses', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    db.slackInstallation.findUnique.mockResolvedValue({ teamName: '크림드' })
    db.spaceCredential.findMany.mockResolvedValue([
      { provider: 'meta-ads', healthError: null },
      { provider: 'naver-commerce', healthError: 'token expired' },
    ])
    db.scNotionConnection.findUnique.mockResolvedValue(null)
    db.scDriveConnection.findUnique.mockResolvedValue({ rootId: 'r', lastError: null })
    db.spaceAgentSetting.findUnique.mockResolvedValue(null)
    db.spaceAgent.count.mockResolvedValue(2)
    db.spaceSecret.count.mockResolvedValue(0)
    db.coupangApiCredential.findUnique.mockResolvedValue({ isActive: true })
    db.coupangCredential.findUnique.mockResolvedValue(null)
    ;(loadIntegrationAttention as jest.Mock).mockResolvedValue([
      { id: 'agent-tokens', message: '토큰 만료 — Claude 공용' },
    ])
  })

  it('ADMIN은 출처별 상태와 확인 필요 목록을 받는다', async () => {
    const { statuses, attention } = await loadIntegrationStatuses('s1', 'u1', 'ADMIN')
    expect(statuses.slack).toEqual({ state: 'connected', summary: '크림드' })
    expect(statuses['meta-ads']?.state).toBe('connected')
    expect(statuses['naver-nbaesong']?.state).toBe('attention')
    expect(statuses['google-marketing']?.state).toBe('not_connected')
    expect(statuses.notion?.state).toBe('not_connected')
    expect(statuses['google-drive']?.state).toBe('connected')
    expect(statuses['workdeck-agent']?.state).toBe('connected')
    expect(statuses['coupang-api']?.state).toBe('connected')
    expect(statuses['coupang-login']?.state).toBe('not_connected')
    expect(statuses['agent-tokens']).toEqual({ state: 'attention', summary: '확인 필요' })
    expect(statuses.secrets?.state).toBe('not_connected')
    expect(attention).toHaveLength(1)
    expect(JSON.stringify(statuses)).not.toContain('token expired')
  })

  it('MEMBER는 관리자 전용 출처를 조회하지 않고 오류 상태도 받지 않는다', async () => {
    const { statuses, attention } = await loadIntegrationStatuses('s1', 'u1', 'MEMBER')
    adminOnlyCalls().forEach((fn) => expect(fn).not.toHaveBeenCalled())
    expect(attention).toEqual([])
    expect(statuses['naver-nbaesong']?.state).toBe('connected')
    expect(statuses['agent-tokens']).toBeUndefined()
    expect(statuses.secrets).toBeUndefined()
    expect(statuses['coupang-api']).toBeUndefined()
    expect(JSON.stringify(statuses)).not.toContain('크림드')
  })

  it('드라이브는 루트 폴더까지 등록해야 연결됨이다', async () => {
    db.scDriveConnection.findUnique.mockResolvedValue({ rootId: null, lastError: null })
    const { statuses } = await loadIntegrationStatuses('s1', 'u1', 'ADMIN')
    expect(statuses['google-drive']?.state).toBe('not_connected')
  })

  it('출처 하나가 실패하면 그 타일만 unknown이다', async () => {
    db.slackInstallation.findUnique.mockRejectedValue(new Error('timeout'))
    db.spaceSecret.count.mockRejectedValue(new Error('timeout'))
    const { statuses } = await loadIntegrationStatuses('s1', 'u1', 'OWNER')
    expect(statuses.slack?.state).toBe('unknown')
    expect(statuses.secrets?.state).toBe('unknown')
    expect(statuses['meta-ads']?.state).toBe('connected')
  })
})
