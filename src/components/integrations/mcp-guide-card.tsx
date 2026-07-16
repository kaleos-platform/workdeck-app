import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Plug } from 'lucide-react'
import { CopyCodeBlock } from './copy-code-block'

const MCP_URL = 'https://app.workdeck.work/api/mcp/mcp'
const CLAUDE_CODE_CMD = `claude mcp add --transport http workdeck ${MCP_URL}`

export function McpGuideCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5" />내 에이전트 연결(MCP)
        </CardTitle>
        <CardDescription>
          Claude Code, claude.ai 등 MCP를 지원하는 클라이언트를 워크덱에 직접 연결합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-1.5">
          <p className="font-medium">1. MCP 서버 URL</p>
          <CopyCodeBlock code={MCP_URL} />
        </div>

        <div className="space-y-1.5">
          <p className="font-medium">2. Claude Code에서 연결</p>
          <CopyCodeBlock code={CLAUDE_CODE_CMD} />
          <p className="text-xs text-muted-foreground">
            터미널에서 실행하면 OAuth 로그인 창이 열립니다. 워크덱 계정으로 로그인하면 연결됩니다.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="font-medium">3. claude.ai에서 연결</p>
          <p className="text-xs text-muted-foreground">
            claude.ai 설정 → 커넥터(Connectors) → 사용자 지정 커넥터 추가에서 위 URL을 등록하면 대화
            중 워크덱 데이터를 조회할 수 있습니다.
          </p>
        </div>

        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          조회(읽기)는 즉시 응답하지만, 데이터를 변경하는 작업은 안전을 위해 승인 큐를 거칩니다.
          연결한 에이전트가 변경을 요청하면 워크덱 승인 대기 화면이나 Slack 승인 채널에서 확인 후
          승인해야 실제로 실행됩니다.
        </div>
      </CardContent>
    </Card>
  )
}
