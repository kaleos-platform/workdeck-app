import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { toolDefinitions } from '@/lib/agent/tools'
import type { ToolDefinition } from '@/lib/agent/tools'
import type { ConversationTurn } from './conversation'

/**
 * workdeck 에이전트 LLM 루프 — Anthropic SDK 수동 tool_use 루프.
 *
 * 규약:
 *  - 모델: claude-opus-4-8 (env WORKDECK_AGENT_MODEL로 오버라이드). 날짜 접미사 금지.
 *  - temperature/top_p/top_k/thinking 파라미터 전송 금지(opus-4-8에서 400 또는 불필요).
 *  - tool 스키마: zod 4의 z.toJSONSchema로 네이티브 변환(Anthropic tool = { name, description, input_schema }).
 *  - stop_reason === "tool_use"면 모든 tool_use 블록을 실행하고 tool_result 전부를 단일 user 메시지로 반환.
 *  - 최대 8 iteration. 초과 시 폴백 텍스트.
 *  - tool ctx는 MCP tool과 동일 { userId } (write tool은 createPendingAction만 호출하므로 안전).
 */

const DEFAULT_MODEL = 'claude-opus-4-8'
const MAX_ITERATIONS = 8
const MAX_TOKENS = 8192

function resolveModel(): string {
  return process.env.WORKDECK_AGENT_MODEL?.trim() || DEFAULT_MODEL
}

// zod raw shape → Anthropic input_schema(JSON Schema object).
function toInputSchema(def: ToolDefinition): Record<string, unknown> {
  return z.toJSONSchema(z.object(def.inputSchema)) as Record<string, unknown>
}

// toolDefinitions 전체를 Anthropic tool 배열로 변환(read/write 모두 — write는 createPendingAction만 호출).
function buildAnthropicTools(): Anthropic.Tool[] {
  return toolDefinitions.map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: toInputSchema(def) as Anthropic.Tool.InputSchema,
  }))
}

function buildSystemPrompt(): string {
  return [
    '당신은 워크덱(Workdeck) 비즈니스 어시스턴트입니다. 사용자는 Slack에서 당신을 멘션해 질문합니다.',
    '워크덱은 재무 관리·브랜드 운영(재고/발주)·쿠팡 광고 등 여러 업무 카드(deck)를 제공합니다.',
    '사용 가능한 데이터와 기능은 제공된 도구(tool)로 파악하세요. 어떤 카드가 활성화됐는지 확실치 않으면 whoami 도구로 확인하세요.',
    '답변은 Slack 메시지에 맞게 간결하게, 반드시 한국어로 작성하세요. 불필요한 서론 없이 핵심부터 전달합니다.',
    '조회(read) 도구는 즉시 실행되지만, 변경(write) 도구는 즉시 반영되지 않고 승인 대기 큐에 등록됩니다.',
    '변경 요청 도구를 사용하면 결과에 승인 대기 상태와 승인 URL(approvalUrl)이 포함됩니다. 이 경우 "승인 대기 큐에 등록했으며 관리자 승인 후 반영된다"는 점과 승인 URL을 사용자에게 안내하세요.',
    '금액은 원 단위로, 날짜는 이해하기 쉽게 표기하세요. 데이터가 없으면 없다고 솔직히 답하세요.',
  ].join('\n')
}

export interface AgentLoopResult {
  text: string
  usage: { inputTokens: number; outputTokens: number }
}

export interface RunAgentLoopArgs {
  requestedBy: string // tool ctx.userId (write tool의 requestedBy로 사용됨)
  userText: string
  history: ConversationTurn[]
}

// name → ToolDefinition 조회맵.
const toolByName = new Map<string, ToolDefinition>(toolDefinitions.map((d) => [d.name, d]))

/**
 * LLM 루프 실행. history(이전 대화 턴) + 이번 사용자 발화로 대화를 구성하고,
 * tool_use가 없을 때까지 최대 8회 반복한다. 누적 usage와 최종 텍스트를 반환한다.
 */
export async function runAgentLoop(args: RunAgentLoopArgs): Promise<AgentLoopResult> {
  const client = new Anthropic() // ANTHROPIC_API_KEY 환경변수 사용
  const model = resolveModel()
  const tools = buildAnthropicTools()
  const ctx = { userId: args.requestedBy }

  const messages: Anthropic.MessageParam[] = [
    ...args.history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: args.userText },
  ]

  let inputTokens = 0
  let outputTokens = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(),
      tools,
      messages,
    })
    inputTokens += response.usage.input_tokens
    outputTokens += response.usage.output_tokens

    // 어시스턴트 응답(전체 content)을 히스토리에 추가 — tool_use 블록 보존 필수.
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason !== 'tool_use') {
      // 종료(end_turn 등) — 텍스트 블록만 모아 반환.
      const text = extractText(response.content)
      return {
        text: text || '죄송합니다. 답변을 생성하지 못했습니다.',
        usage: { inputTokens, outputTokens },
      }
    }

    // tool_use 블록 전부 실행 → tool_result 전부를 단일 user 메시지로 반환.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const def = toolByName.get(tu.name)
      if (!def) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `알 수 없는 도구입니다: ${tu.name}`,
          is_error: true,
        })
        continue
      }
      try {
        const result = await def.execute(ctx, (tu.input ?? {}) as Record<string, unknown>)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result ?? null),
        })
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: err instanceof Error ? err.message : '도구 실행 중 오류가 발생했습니다.',
          is_error: true,
        })
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  // 8회 초과 — 폴백.
  return {
    text: '작업이 너무 복잡합니다. 질문을 나눠서 다시 시도해주세요.',
    usage: { inputTokens, outputTokens },
  }
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}
