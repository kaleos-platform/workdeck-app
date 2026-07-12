import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { verifyToken } from '@/lib/mcp/auth'
import { toolDefinitions } from '@/lib/agent/tools'

// MCP 핸들러 — toolDefinitions 배열을 순회하며 각 tool을 등록한다.
const handler = createMcpHandler(
  (server) => {
    for (const def of toolDefinitions) {
      server.registerTool(
        def.name,
        {
          title: def.name,
          description: def.description,
          inputSchema: def.inputSchema,
        },
        async (args, extra) => {
          // withMcpAuth가 required:true로 보장하므로 userId는 존재해야 하지만
          // 이론상 누락 시 방어적으로 isError 응답한다.
          const userId = extra.authInfo?.extra?.userId as string | undefined
          if (!userId) {
            return {
              content: [{ type: 'text', text: '인증 정보가 없습니다' }],
              isError: true,
            }
          }

          try {
            const result = await def.execute({ userId }, (args ?? {}) as Record<string, unknown>)
            return {
              structuredContent: result as Record<string, unknown>,
              content: [{ type: 'text', text: `${def.name} 실행 완료: ${JSON.stringify(result)}` }],
            }
          } catch (err) {
            // execute의 throw(한국어 Error)를 MCP 에러 규약으로 변환한다.
            const message = err instanceof Error ? err.message : '알 수 없는 오류'
            return {
              content: [{ type: 'text', text: message }],
              isError: true,
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
