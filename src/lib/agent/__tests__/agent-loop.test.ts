// @jest-environment node
import { runAgentLoop } from '../llm/agent-loop'
import { toolDefinitions } from '@/lib/agent/tools'

// Anthropic SDK mock — new Anthropic() 인스턴스의 messages.create를 통제한다.
// (실 API 호출 금지.)
const mockCreate = jest.fn()
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }))
})

// tool 레지스트리 — kpi(read) + trigger(write) 스텁.
jest.mock('@/lib/agent/tools', () => {
  const kpiExec = jest.fn(async () => ({ adCost: 1000, revenue: 5000 }))
  const writeExec = jest.fn(async () => ({
    status: 'pending_approval',
    approvalUrl: 'https://x/approvals?action=a1',
  }))
  return {
    toolDefinitions: [
      { name: 'ads_get_kpi', description: 'kpi', inputSchema: {}, mode: 'read', execute: kpiExec },
      {
        name: 'ads_trigger_analysis',
        description: 'analysis',
        inputSchema: {},
        mode: 'write',
        execute: writeExec,
      },
    ],
  }
})

function execOf(name: string): jest.Mock {
  return toolDefinitions.find((d) => d.name === name)!.execute as unknown as jest.Mock
}

// messages 배열에서 tool_result 블록을 담은 user 메시지를 찾는다.
// (runAgentLoop이 배열을 참조로 계속 변형하므로 인덱스 위치가 아니라 내용으로 찾는다.)
type AnyMsg = { role: string; content: unknown }
function findToolResultMsg(msgs: AnyMsg[]): AnyMsg & { content: Array<Record<string, unknown>> } {
  const found = msgs.find(
    (m) =>
      m.role === 'user' &&
      Array.isArray(m.content) &&
      (m.content[0] as Record<string, unknown> | undefined)?.type === 'tool_result'
  )
  return found as AnyMsg & { content: Array<Record<string, unknown>> }
}

const baseArgs = { requestedBy: 'user-1', userText: '광고 상태 알려줘', history: [] }

describe('runAgentLoop', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('tool_use 1회 후 end_turn 정상 왕복', async () => {
    // 1차: kpi tool 호출. 2차: 최종 텍스트.
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'ads_get_kpi', input: {} }],
        usage: { input_tokens: 100, output_tokens: 20 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '광고비는 1000원입니다.' }],
        usage: { input_tokens: 150, output_tokens: 30 },
      })

    const r = await runAgentLoop(baseArgs)
    expect(execOf('ads_get_kpi')).toHaveBeenCalledTimes(1)
    expect(r.text).toBe('광고비는 1000원입니다.')
    // 누적 usage.
    expect(r.usage.inputTokens).toBe(250)
    expect(r.usage.outputTokens).toBe(50)
    // tool_result가 단일 user 메시지로 반환됐는지(messages 배열은 참조로 계속 변형되므로
    // 마지막 위치가 아니라 tool_result를 담은 user 메시지를 찾아 검증).
    const msgs = mockCreate.mock.calls[1][0].messages
    const toolResultMsg = findToolResultMsg(msgs)
    expect(toolResultMsg).toBeDefined()
    expect(toolResultMsg.role).toBe('user')
    expect(toolResultMsg.content[0].type).toBe('tool_result')
  })

  test('8 iteration 초과 → 폴백 텍스트', async () => {
    // 매번 tool_use만 반환해 종료되지 않게 한다.
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu', name: 'ads_get_kpi', input: {} }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    const r = await runAgentLoop(baseArgs)
    expect(r.text).toContain('너무 복잡')
    // 정확히 8회 API 호출.
    expect(mockCreate).toHaveBeenCalledTimes(8)
  })

  test('write tool 결과(pending)가 tool_result로 반환됨', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tw', name: 'ads_trigger_analysis', input: {} }],
        usage: { input_tokens: 100, output_tokens: 20 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '승인 대기 등록됨' }],
        usage: { input_tokens: 120, output_tokens: 25 },
      })

    const r = await runAgentLoop(baseArgs)
    expect(execOf('ads_trigger_analysis')).toHaveBeenCalledTimes(1)
    const toolResultMsg = findToolResultMsg(mockCreate.mock.calls[1][0].messages)
    const resultContent = toolResultMsg.content[0].content as string
    expect(resultContent).toContain('pending_approval')
    expect(resultContent).toContain('approvalUrl')
    expect(r.text).toBe('승인 대기 등록됨')
  })

  test('알 수 없는 tool → is_error tool_result', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tx', name: 'nonexistent_tool', input: {} }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '처리했습니다' }],
        usage: { input_tokens: 12, output_tokens: 6 },
      })

    await runAgentLoop(baseArgs)
    const toolResultMsg = findToolResultMsg(mockCreate.mock.calls[1][0].messages)
    expect(toolResultMsg.content[0].is_error).toBe(true)
  })
})
