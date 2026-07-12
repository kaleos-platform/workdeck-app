import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from 'mcp-handler'

// MCP 클라이언트가 인증 서버를 발견하도록 protected-resource 메타데이터를 노출한다.
// authServerUrls = Supabase Auth 엔드포인트.
const handler = protectedResourceHandler({
  authServerUrls: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
})

const corsHandler = metadataCorsOptionsRequestHandler()

export { handler as GET, corsHandler as OPTIONS }
