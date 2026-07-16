// @jest-environment node
import { routeAgentMessage } from '../router'
import { toolDefinitions } from '@/lib/agent/tools'
import { checkAndIncrementUsage } from '../llm/usage'
import { runAgentLoop } from '../llm/agent-loop'
import { loadConversation, appendConversation } from '../llm/conversation'
import { prisma } from '@/lib/prisma'

// tool 레지스트리를 통제 가능한 스텁으로 대체. execute를 감시해 정형 명령이
// 올바른 tool을 부르는지 검증한다.
jest.mock('@/lib/agent/tools', () => {
  const mk = (name: string, mode: 'read' | 'write' = 'read') => ({
    name,
    description: name,
    inputSchema: {},
    mode,
    execute: jest.fn(async () => ({ ok: true, tool: name })),
  })
  const defs = [
    mk('whoami'),
    mk('ads_get_kpi'),
    mk('ads_list_campaigns'),
    mk('ads_get_campaign'),
    mk('ads_get_inefficient_keywords'),
    mk('ads_get_latest_report'),
    mk('ads_trigger_analysis', 'write'),
  ]
  return { toolDefinitions: defs }
})

jest.mock('../llm/usage', () => ({
  checkAndIncrementUsage: jest.fn(),
  recordTokens: jest.fn(async () => {}),
}))
jest.mock('../llm/agent-loop', () => ({
  runAgentLoop: jest.fn(),
}))
jest.mock('../llm/conversation', () => ({
  loadConversation: jest.fn(async () => []),
  appendConversation: jest.fn(async () => {}),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceAgent: { findUnique: jest.fn() },
    agentPendingAction: { findMany: jest.fn() },
  },
}))

const mockUsage = checkAndIncrementUsage as jest.Mock
const mockLoop = runAgentLoop as jest.Mock
const mockLoad = loadConversation as jest.Mock
const mockAppend = appendConversation as jest.Mock
const mockPrisma = prisma as unknown as {
  spaceAgent: { findUnique: jest.Mock }
  agentPendingAction: { findMany: jest.Mock }
}

// 특정 tool의 execute mock을 이름으로 꺼낸다.
function toolExec(name: string): jest.Mock {
  const def = toolDefinitions.find((d) => d.name === name)!
  return def.execute as unknown as jest.Mock
}

const baseArgs = {
  spaceId: 'space-1',
  requestedBy: 'user-1',
  channelId: 'C1',
  threadTs: 'T1',
}

describe('routeAgentMessage — 정형 명령 매칭', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.spaceAgent.findUnique.mockResolvedValue(null)
    mockPrisma.agentPendingAction.findMany.mockResolvedValue([])
    mockUsage.mockResolvedValue({ allowed: true })
    mockLoop.mockResolvedValue({ text: 'LLM 응답', usage: { inputTokens: 10, outputTokens: 5 } })
  })

  test('"상태" → ads_get_kpi 직접 실행, LLM 미호출', async () => {
    const r = await routeAgentMessage({ ...baseArgs, text: '상태' })
    expect(toolExec('ads_get_kpi')).toHaveBeenCalledTimes(1)
    expect(mockLoop).not.toHaveBeenCalled()
    expect(r.text).toContain('KPI')
  })

  test('"캠페인 목록" → ads_list_campaigns (상세보다 우선)', async () => {
    await routeAgentMessage({ ...baseArgs, text: '캠페인 목록' })
    expect(toolExec('ads_list_campaigns')).toHaveBeenCalled()
    expect(toolExec('ads_get_campaign')).not.toHaveBeenCalled()
    expect(mockLoop).not.toHaveBeenCalled()
  })

  test('"캠페인 여름세일" → list 후 상세 조회 (식별자=id)', async () => {
    toolExec('ads_list_campaigns').mockResolvedValueOnce({
      campaigns: [{ id: 'c-9', name: '여름세일', displayName: '여름세일' }],
    })
    toolExec('ads_get_campaign').mockResolvedValueOnce({
      campaign: { displayName: '여름세일' },
      metricSeries: [{ adCost: 1000, totalRevenue: 3000 }],
    })
    await routeAgentMessage({ ...baseArgs, text: '캠페인 여름세일' })
    // 상세 tool에 list의 id가 campaignId로 전달됐는지.
    expect(toolExec('ads_get_campaign')).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ campaignId: 'c-9' })
    )
    expect(mockLoop).not.toHaveBeenCalled()
  })

  test('"비효율" → ads_get_inefficient_keywords (첫 캠페인 id 사용)', async () => {
    toolExec('ads_list_campaigns').mockResolvedValueOnce({ campaigns: [{ id: 'c-1' }] })
    toolExec('ads_get_inefficient_keywords').mockResolvedValueOnce({ items: [] })
    await routeAgentMessage({ ...baseArgs, text: '비효율 키워드 알려줘' })
    expect(toolExec('ads_get_inefficient_keywords')).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ campaignId: 'c-1' })
    )
    expect(mockLoop).not.toHaveBeenCalled()
  })

  test('"분석" → ads_trigger_analysis (write, 승인 안내)', async () => {
    toolExec('ads_trigger_analysis').mockResolvedValueOnce({
      status: 'pending_approval',
      approvalUrl: 'https://x/approvals?action=a1',
    })
    const r = await routeAgentMessage({ ...baseArgs, text: '분석 실행' })
    expect(toolExec('ads_trigger_analysis')).toHaveBeenCalled()
    expect(r.text).toContain('승인')
    expect(mockLoop).not.toHaveBeenCalled()
  })

  test('"리포트" → ads_get_latest_report', async () => {
    await routeAgentMessage({ ...baseArgs, text: '리포트 보여줘' })
    expect(toolExec('ads_get_latest_report')).toHaveBeenCalled()
    expect(mockLoop).not.toHaveBeenCalled()
  })

  test('"태스크" → 승인 대기 목록 조회(AgentPendingAction), LLM 미호출', async () => {
    await routeAgentMessage({ ...baseArgs, text: '태스크' })
    expect(mockPrisma.agentPendingAction.findMany).toHaveBeenCalled()
    expect(mockLoop).not.toHaveBeenCalled()
  })

  test('"승인 abc123" → 직접 승인 금지 안내, tool 미실행', async () => {
    const r = await routeAgentMessage({ ...baseArgs, text: '승인 abc123' })
    expect(r.text).toContain('승인 버튼')
    expect(mockLoop).not.toHaveBeenCalled()
  })

  test('"도움" → 정적 도움말, LLM 미호출', async () => {
    const r = await routeAgentMessage({ ...baseArgs, text: '도움' })
    expect(r.text).toContain('명령 안내')
    expect(mockLoop).not.toHaveBeenCalled()
  })
})

describe('routeAgentMessage — LLM 폴백', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.spaceAgent.findUnique.mockResolvedValue(null)
    mockUsage.mockResolvedValue({ allowed: true })
    mockLoad.mockResolvedValue([])
    mockLoop.mockResolvedValue({ text: 'LLM 응답', usage: { inputTokens: 10, outputTokens: 5 } })
  })

  test('미매칭 자연어 → LLM 루프 진입 + 대화 저장', async () => {
    const r = await routeAgentMessage({ ...baseArgs, text: '이번 달 지출이 얼마야?' })
    expect(mockLoop).toHaveBeenCalledTimes(1)
    expect(mockAppend).toHaveBeenCalled()
    expect(r.text).toBe('LLM 응답')
  })

  test('SpaceAgent 비활성 → LLM 미호출, 안내 텍스트', async () => {
    mockPrisma.spaceAgent.findUnique.mockResolvedValue({ isActive: false })
    const r = await routeAgentMessage({ ...baseArgs, text: '아무 질문' })
    expect(mockLoop).not.toHaveBeenCalled()
    expect(r.text).toContain('비활성화')
  })

  test('일일 한도 초과 → LLM 미호출, 사유 안내', async () => {
    mockUsage.mockResolvedValue({ allowed: false, reason: '한도 초과' })
    const r = await routeAgentMessage({ ...baseArgs, text: '아무 질문' })
    expect(mockLoop).not.toHaveBeenCalled()
    expect(r.text).toContain('한도 초과')
  })
})
