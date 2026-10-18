'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'
import { SCOPES } from '@/lib/agent/identity/principal'
import { CopyCodeBlock } from './copy-code-block'
import { CLAUDE_CODE_CMD, MCP_URL } from './mcp-guide-card'

type Token = {
  id: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}
type Agent = {
  id: string
  name: string
  kind: 'agent' | 'integration'
  scopes: string[]
  status: 'ACTIVE' | 'DISABLED'
  tokens: Token[]
}
// 발급 직후 한 번만 보여 줄 토큰 — 대화상자를 닫으면 버린다.
type Issued = { agentId: string; token: string | null }
type EditTarget = { mode: 'create' } | { mode: 'scopes'; agent: Agent }

const NET_ERR = '네트워크 오류로 요청하지 못했습니다.'
const KIND_LABEL = { agent: '에이전트', integration: '연동 계정' } as const
const SCOPE_GROUPS = [
  { label: '읽기', scopes: SCOPES.filter((s) => s.endsWith(':read')) },
  { label: '쓰기(제안)', scopes: SCOPES.filter((s) => s.endsWith(':write')) },
]
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('ko-KR') : '-')
const tokenState = (t: Token) =>
  t.revokedAt ? '폐기' : t.expiresAt && new Date(t.expiresAt) < new Date() ? '만료' : '활성'
// 토큰을 명령에 직접 넣으면 셸 기록에 남는다 — 환경변수로 넘긴다.
const CONFIG_SNIPPET = `export WORKDECK_AGENT_TOKEN='<위 토큰>'\n${CLAUDE_CODE_CMD} --header "Authorization: Bearer $WORKDECK_AGENT_TOKEN"`

export function AgentTokensCard() {
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [edit, setEdit] = useState<EditTarget | null>(null)
  const [issue, setIssue] = useState<Issued | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/spaces/members')
      const body = await res.json().catch(() => null)
      if (!res.ok) return setError(body?.message ?? '에이전트 목록을 불러오지 못했습니다')
      setSpaceId(body.spaceId)
      const ar = await fetch(`/api/spaces/${body.spaceId}/agents`)
      const ab = await ar.json().catch(() => null)
      if (!ar.ok) return setError(ab?.message ?? '에이전트 목록을 불러오지 못했습니다')
      setAgents(ab.agents)
    } catch {
      setError(NET_ERR)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 변경 요청 공통 — MFA 필요하면 단계 인증으로, 실패하면 메시지, 성공하면 응답 본문.
  async function mutate(path: string, init: RequestInit, failMessage: string) {
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/spaces/${spaceId}/agents${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
      if (await redirectIfMfaRequired(res)) return null
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.message ?? failMessage)
        return null
      }
      return body ?? {}
    } catch {
      setError(NET_ERR)
      return null
    } finally {
      setPending(false)
    }
  }

  async function toggle(a: Agent, on: boolean) {
    const body = { status: on ? 'ACTIVE' : 'DISABLED' }
    if (
      await mutate(
        `/${a.id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        '상태를 바꾸지 못했습니다'
      )
    )
      await load()
  }

  async function revoke(a: Agent, t: Token) {
    if (!confirm(`${a.name}의 토큰을 폐기할까요? 이 토큰을 쓰는 연결은 즉시 끊깁니다.`)) return
    if (await mutate(`/${a.id}/tokens/${t.id}`, { method: 'DELETE' }, '토큰을 폐기하지 못했습니다'))
      await load()
  }

  async function saveAgent(name: string, kind: Agent['kind'], scopes: string[]) {
    const ok =
      edit?.mode === 'scopes'
        ? await mutate(
            `/${edit.agent.id}`,
            { method: 'PATCH', body: JSON.stringify({ scopes }) },
            '권한을 저장하지 못했습니다'
          )
        : await mutate(
            '',
            { method: 'POST', body: JSON.stringify({ name: name.trim(), kind, scopes }) },
            '에이전트를 추가하지 못했습니다'
          )
    if (!ok) return
    setEdit(null)
    await load()
  }

  async function issueToken(days: number) {
    if (!issue) return
    const body = await mutate(
      `/${issue.agentId}/tokens`,
      { method: 'POST', body: JSON.stringify({ expiresInDays: days }) },
      '토큰을 발급하지 못했습니다'
    )
    if (!body) return
    setIssue({ agentId: issue.agentId, token: body.token })
    await load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          에이전트·토큰 관리
        </CardTitle>
        <CardDescription>
          외부 에이전트와 연동 계정을 등록하고, 권한(scope)과 MCP 접속 토큰을 관리합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        <div>
          <Button size="sm" onClick={() => setEdit({ mode: 'create' })} disabled={!spaceId}>
            에이전트 추가
          </Button>
        </div>
        {agents.length === 0 && (
          <p className="text-muted-foreground">등록된 에이전트가 없습니다.</p>
        )}
        {agents.map((a) => (
          <div key={a.id} className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.name}</span>
                <Badge variant="outline">{KIND_LABEL[a.kind]}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`agent-${a.id}`} className="text-muted-foreground">
                  {a.status === 'ACTIVE' ? '활성' : '비활성'}
                </Label>
                <Switch
                  id={`agent-${a.id}`}
                  checked={a.status === 'ACTIVE'}
                  onCheckedChange={(v) => toggle(a, v)}
                  disabled={pending}
                  aria-label={`${a.name} 활성`}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {a.scopes.length === 0 && <span className="text-muted-foreground">권한 없음</span>}
              {a.scopes.map((s) => (
                <Badge key={s} variant="secondary" className="font-mono text-xs">
                  {s}
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEdit({ mode: 'scopes', agent: a })}
              >
                권한 수정
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIssue({ agentId: a.id, token: null })}
                disabled={a.status !== 'ACTIVE'}
              >
                토큰 발급
              </Button>
            </div>
            {a.tokens.length > 0 && (
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 font-normal">발급일</th>
                    <th className="py-1 font-normal">마지막 사용</th>
                    <th className="py-1 font-normal">만료</th>
                    <th className="py-1 font-normal">상태</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {a.tokens.map((t) => {
                    const state = tokenState(t)
                    return (
                      <tr key={t.id}>
                        <td className="py-1">{fmt(t.createdAt)}</td>
                        <td className="py-1">{fmt(t.lastUsedAt)}</td>
                        <td className="py-1">{fmt(t.expiresAt)}</td>
                        <td className="py-1">{state}</td>
                        <td className="py-1 text-right">
                          {state === '활성' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => revoke(a, t)}
                              disabled={pending}
                            >
                              폐기
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </CardContent>

      {edit && (
        <AgentDialog
          key={edit.mode === 'scopes' ? edit.agent.id : 'create'}
          target={edit}
          pending={pending}
          onClose={() => setEdit(null)}
          onSave={saveAgent}
        />
      )}
      {issue && (
        <IssueDialog
          token={issue.token}
          pending={pending}
          onClose={() => setIssue(null)}
          onIssue={issueToken}
        />
      )}
    </Card>
  )
}

function AgentDialog({
  target,
  pending,
  onClose,
  onSave,
}: {
  target: EditTarget
  pending: boolean
  onClose: () => void
  onSave: (name: string, kind: Agent['kind'], scopes: string[]) => void
}) {
  const creating = target.mode === 'create'
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Agent['kind']>('agent')
  const [scopes, setScopes] = useState<string[]>(creating ? [] : target.agent.scopes)
  const flip = (s: string, on: boolean) =>
    setScopes((prev) => (on ? [...prev, s] : prev.filter((x) => x !== s)))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {creating ? '에이전트 추가' : `권한 수정 — ${target.agent.name}`}
          </DialogTitle>
          <DialogDescription>
            쓰기 권한은 &quot;제안 가능&quot;을 뜻합니다. 실제 실행은 구성원 승인 뒤에 이뤄집니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {creating && (
            <div className="flex flex-wrap gap-2">
              <Input
                className="flex-1"
                placeholder="이름"
                aria-label="에이전트 이름"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Select value={kind} onValueChange={(v) => setKind(v as Agent['kind'])}>
                <SelectTrigger className="w-32" aria-label="종류">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">{KIND_LABEL.agent}</SelectItem>
                  <SelectItem value="integration">{KIND_LABEL.integration}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {SCOPE_GROUPS.map((g) => (
            <div key={g.label} className="space-y-2">
              <p className="font-medium">{g.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {g.scopes.map((s) => (
                  <label key={s} className="flex items-center gap-2 font-mono text-xs">
                    <Checkbox
                      checked={scopes.includes(s)}
                      onCheckedChange={(v) => flip(s, v === true)}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            onClick={() => onSave(name, kind, scopes)}
            disabled={pending || (creating && !name.trim())}
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function IssueDialog({
  token,
  pending,
  onClose,
  onIssue,
}: {
  token: string | null
  pending: boolean
  onClose: () => void
  onIssue: (days: number) => void
}) {
  const [days, setDays] = useState('90')
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
    } catch {
      // 클립보드를 못 쓰면 읽기 전용 입력에서 직접 복사한다.
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>토큰 발급</DialogTitle>
          <DialogDescription>
            MCP 클라이언트가 이 에이전트로 접속할 때 쓰는 토큰입니다.
          </DialogDescription>
        </DialogHeader>
        {token ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium text-destructive">이 창을 닫으면 다시 볼 수 없습니다.</p>
            <div className="flex gap-2">
              <Input
                readOnly
                aria-label="발급된 토큰"
                className="font-mono text-xs"
                value={token}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button variant="outline" onClick={copy}>
                {copied ? '복사됨' : '복사'}
              </Button>
            </div>
            <div className="space-y-1.5">
              <p className="font-medium">MCP 서버 URL</p>
              <CopyCodeBlock code={MCP_URL} />
            </div>
            <div className="space-y-1.5">
              <p className="font-medium">Claude Code 예시</p>
              <CopyCodeBlock code={CONFIG_SNIPPET} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span>만료</span>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-32" aria-label="만료 기간">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30일</SelectItem>
                <SelectItem value="90">90일</SelectItem>
                <SelectItem value="365">365일</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          {!token && (
            <Button onClick={() => onIssue(Number(days))} disabled={pending}>
              발급
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
