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
            const isPending = structuredContent.status === 'pending_approval'
            const text = isPending
              ? `승인 대기 큐에 등록했습니다(승인 후 실행됨). 승인 URL: ${structuredContent.approvalUrl ?? '(웹 승인 큐)'} (workId: ${ctx.workId})`
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
