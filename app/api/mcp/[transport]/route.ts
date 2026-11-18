import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { verifyToken } from '@/lib/mcp/auth'
import { toolDefinitions } from '@/lib/agent/tools'
import {
  buildToolContext,
  META_ARG_SHAPE,
  readAuthExtra,
  runTool,
  splitMetaArgs,
  toolErrorMessage,
  withRequester,
} from '@/lib/agent/tools/run-tool'

// MCP 핸들러 — toolDefinitions 배열을 순회하며 각 tool을 등록한다.
const handler = createMcpHandler(
  (server) => {
    for (const def of toolDefinitions) {
      server.registerTool(
        def.name,
        {
          title: def.name,
          description: def.description,
          inputSchema: { ...def.inputSchema, ...META_ARG_SHAPE },
        },
        async (args, extra) => {
          // verifyToken(Task 4)이 넣은 extra = { spaceId, actor, scopes } | { authError }.
          const auth = readAuthExtra(extra.authInfo?.extra)
          if (!auth.ok) {
            return { content: [{ type: 'text', text: auth.reason }], isError: true }
          }
          const { meta, toolArgs } = splitMetaArgs((args ?? {}) as Record<string, unknown>)
          const ctx = await withRequester(
            buildToolContext(auth.principal, meta),
            meta.requesterSlackUserId
          )
          try {
            const result = await runTool(def, ctx, toolArgs)
            const structuredContent: Record<string, unknown> =
              result && typeof result === 'object' && !Array.isArray(result)
                ? { ...(result as Record<string, unknown>), workId: ctx.workId }
                : { result, workId: ctx.workId }
            // write tool은 즉시 실행되지 않고 승인 큐에 등록된다 — "실행 완료"로 오인 안내하지 않도록 분기한다.
            // def.mode가 아니라 결과 status로만 판단한다(바로 실행되는 write 도구가 생길 수 있다).
            // 초안 자동 실행이 켜진 에이전트는 executed·failed 등 실제 상태로 돌아온다.
            const status = structuredContent.status
            const pendingText = `승인 대기 큐에 등록했습니다(승인 후 실행됨). 승인 URL: ${structuredContent.approvalUrl ?? '(웹 승인 큐)'} (workId: ${ctx.workId})`
            const text =
              status === 'pending_approval'
                ? pendingText
                : status === 'executed' && typeof structuredContent.actionId === 'string'
                  ? `초안을 만들었습니다: ${structuredContent.resultUrl ?? '(링크 없음)'} (workId: ${ctx.workId})`
                  : status === 'executing' && typeof structuredContent.actionId === 'string'
                    ? `실행 중입니다 (workId: ${ctx.workId})`
                    : status === 'failed' && typeof structuredContent.actionId === 'string'
                      ? `실행 실패: ${structuredContent.error ?? '알 수 없는 오류'} (workId: ${ctx.workId})`
                      : (status === 'expired' || status === 'rejected') &&
                          typeof structuredContent.actionId === 'string'
                        ? `실행되지 않았습니다(${status === 'expired' ? '승인 기간 만료' : '거절됨'}) (workId: ${ctx.workId})`
                        : `${def.name} 실행 완료 (workId: ${ctx.workId}): ${JSON.stringify(result)}`
            return {
              structuredContent,
              content: [{ type: 'text', text }],
              _meta: { workId: ctx.workId },
            }
          } catch (err) {
            // execute의 throw(한국어 Error)와 scope 거부를 MCP 에러 규약으로 변환한다.
            // 도메인 오류(ToolUserError)만 원문, 나머지는 일반 문구 — 원인은 감사 행·서버 로그에 남는다.
            const message = toolErrorMessage(err)
            return {
              content: [{ type: 'text', text: message }],
              isError: true,
              _meta: { workId: ctx.workId },
            }
          }
        }
      )
    }
  },
  { serverInfo: { name: 'workdeck', version: '1.0.0' }, capabilities: { tools: {} } },
  { basePath: '/api/mcp', maxDuration: 60, disableSse: true }
)

// OAuth bearer 인증 래퍼 — verifyToken이 undefined 반환 시 401.
const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
})

export { authHandler as GET, authHandler as POST }
