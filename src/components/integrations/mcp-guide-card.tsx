'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plug } from 'lucide-react'
import { CopyCodeBlock } from './copy-code-block'

const MCP_URL = 'https://app.workdeck.work/api/mcp/mcp'
const CLAUDE_CODE_CMD = `claude mcp add --transport http workdeck ${MCP_URL}`
const CODEX_CONFIG = `[mcp_servers.workdeck]
command = "npx"
args = ["-y", "mcp-remote", "${MCP_URL}"]`
const HERMES_ADD_CMD = `hermes mcp add workdeck --url ${MCP_URL} --auth oauth`
const HERMES_LOGIN_CMD = `hermes mcp login workdeck`

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
          <p className="font-medium">MCP 서버 URL</p>
          <CopyCodeBlock code={MCP_URL} />
        </div>

        <Tabs defaultValue="claude-code">
          <TabsList>
            <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
            <TabsTrigger value="claude-ai">claude.ai</TabsTrigger>
            <TabsTrigger value="codex">Codex</TabsTrigger>
            <TabsTrigger value="hermes">Hermes</TabsTrigger>
          </TabsList>

          <TabsContent value="claude-code" className="space-y-1.5 pt-3">
            <CopyCodeBlock code={CLAUDE_CODE_CMD} />
            <p className="text-xs text-muted-foreground">
              터미널에서 실행 후 Claude Code에서 처음 사용할 때 브라우저 OAuth 로그인 창이 열립니다.
              워크덱 계정으로 로그인·동의하면 연결됩니다. 연결 상태는{' '}
              <code className="rounded bg-muted px-1">/mcp</code> 명령으로 확인할 수 있습니다.
            </p>
          </TabsContent>

          <TabsContent value="claude-ai" className="space-y-1.5 pt-3">
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>claude.ai → 설정 → 커넥터(Connectors)</li>
              <li>&quot;사용자 지정 커넥터 추가&quot;에서 위 MCP 서버 URL 입력</li>
              <li>워크덱 계정으로 로그인·동의</li>
            </ol>
            <p className="text-xs text-muted-foreground">
              연결 후 대화에서 워크덱 데이터를 바로 조회할 수 있습니다.
            </p>
          </TabsContent>

          <TabsContent value="codex" className="space-y-1.5 pt-3">
            <p className="text-xs text-muted-foreground">
              Codex CLI는 stdio 방식 MCP 서버를 지원하므로 mcp-remote 브리지로 연결합니다.{' '}
              <code className="rounded bg-muted px-1">~/.codex/config.toml</code>에 추가:
            </p>
            <CopyCodeBlock code={CODEX_CONFIG} />
            <p className="text-xs text-muted-foreground">
              Codex 실행 시 브라우저 OAuth 동의 창이 한 번 열립니다.
            </p>
          </TabsContent>

          <TabsContent value="hermes" className="space-y-1.5 pt-3">
            <CopyCodeBlock code={HERMES_ADD_CMD} />
            <CopyCodeBlock code={HERMES_LOGIN_CMD} />
            <p className="text-xs text-muted-foreground">
              login 실행 시 출력되는 인가 URL 중 <strong>마지막 URL</strong>을 브라우저에서 열어
              동의하세요(URL이 두 번 출력되면 첫 번째는 만료된 것입니다). docker 등 헤드리스
              환경이면 호스트에서{' '}
              <code className="rounded bg-muted px-1">HERMES_HOME=&lt;설정 디렉토리&gt;</code>를
              지정해 실행한 뒤 컨테이너를 재시작하면 됩니다.
            </p>
          </TabsContent>
        </Tabs>

        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          조회(읽기)는 즉시 응답하지만, 데이터를 변경하는 작업은 안전을 위해 승인 큐를 거칩니다.
          연결한 에이전트가 변경을 요청하면 워크덱 승인 대기 화면이나 Slack 승인 채널에서 확인 후
          승인해야 실제로 실행됩니다.
        </div>
      </CardContent>
    </Card>
  )
}
