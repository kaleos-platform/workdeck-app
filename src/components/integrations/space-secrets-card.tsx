'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'

type SecretMeta = {
  name: string
  baseUrl: string | null
  readOpIds: string[]
  allowedAgentIds: string[]
  lastUsedAt: string | null
  lastError: string | null
}
type AgentChoice = { id: string; name: string; status?: string }

const NET_ERR = '네트워크 오류로 요청하지 못했습니다.'
const REVEAL_MS = 30_000
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('ko-KR') : '-')
const secretPath = (spaceId: string, name: string) =>
  `/api/spaces/${spaceId}/secrets/${encodeURIComponent(name)}`

export function SpaceSecretsCard() {
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const [spaceName, setSpaceName] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<SecretMeta[]>([])
  const [agents, setAgents] = useState<AgentChoice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // 등록(이름 없음)·교체(이름 지정) 대화상자
  const [edit, setEdit] = useState<{ name: string } | null>(null)
  // 보기로 연 평문 — 30초 뒤·언마운트 시 state에서 지운다.
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearReveal = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setRevealed(null)
  }, [])
  useEffect(() => clearReveal, [clearReveal])

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/spaces/members')
      const body = await res.json().catch(() => null)
      if (!res.ok) return setError(body?.message ?? '비밀값 목록을 불러오지 못했습니다')
      setSpaceId(body.spaceId)
      setSpaceName(body.spaceName ?? null)
      const [sr, ar] = await Promise.all([
        fetch(`/api/spaces/${body.spaceId}/secrets`),
        fetch(`/api/spaces/${body.spaceId}/agents`),
      ])
      const sb = await sr.json().catch(() => null)
      if (!sr.ok) return setError(sb?.message ?? '비밀값 목록을 불러오지 못했습니다')
      setSecrets(sb.secrets)
      const ab = await ar.json().catch(() => null)
      // PUT은 ACTIVE 에이전트만 받는다.
      if (ar.ok) setAgents((ab.agents as AgentChoice[]).filter((a) => a.status !== 'DISABLED'))
    } catch {
      setError(NET_ERR)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 변경·보기 요청 공통 — MFA 필요하면 단계 인증으로 보내고 null, 실패하면 메시지를 돌려준다.
  async function call(path: string, init: RequestInit, failMessage: string) {
    setPending(true)
    try {
      const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
      if (await redirectIfMfaRequired(res)) return { ok: false as const, message: null }
      const body = await res.json().catch(() => null)
      if (!res.ok) return { ok: false as const, message: body?.message ?? failMessage }
      return { ok: true as const, body: body ?? {} }
    } catch {
      return { ok: false as const, message: NET_ERR }
    } finally {
      setPending(false)
    }
  }

  async function save(name: string, payload: object): Promise<string | null> {
    const r = await call(
      secretPath(spaceId!, name),
      { method: 'PUT', body: JSON.stringify({ kind: 'API_KEY', ...payload }) },
      '비밀값을 저장하지 못했습니다'
    )
    if (!r.ok) return r.message ?? ''
    setEdit(null)
    await load()
    return null
  }

  async function reveal(name: string) {
    setError(null)
    const r = await call(
      `${secretPath(spaceId!, name)}/reveal`,
      { method: 'POST' },
      '값을 불러오지 못했습니다'
    )
    if (!r.ok) return r.message && setError(r.message)
    clearReveal()
    setRevealed({ name, value: r.body.value })
    timer.current = setTimeout(clearReveal, REVEAL_MS)
  }

  async function remove(name: string) {
    if (!confirm(`${name}을(를) 삭제할까요? 이 값을 쓰는 에이전트 호출은 즉시 실패합니다.`)) return
    setError(null)
    const r = await call(secretPath(spaceId!, name), { method: 'DELETE' }, '삭제하지 못했습니다')
    if (!r.ok) return r.message && setError(r.message)
    if (revealed?.name === name) clearReveal()
    await load()
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockKeyhole className="h-5 w-5" />
          {spaceName ? `「${spaceName}」 비밀값` : '비밀값'}
        </CardTitle>
        <CardDescription>
          에이전트가 외부 API를 호출할 때 쓰는 키를 암호화해 보관합니다. 에이전트는 값을 보지 못하고
          등록된 조회 operation만 호출합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        <div>
          <Button size="sm" onClick={() => setEdit({ name: '' })} disabled={!spaceId}>
            비밀값 등록
          </Button>
        </div>
        {secrets.length === 0 && <p className="text-muted-foreground">등록된 비밀값이 없습니다.</p>}
        {secrets.map((s) => (
          <div key={s.name} className="space-y-2 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono font-medium">{s.name}</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reveal(s.name)}
                  disabled={pending}
                >
                  보기
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEdit({ name: s.name })}>
                  교체
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s.name)} disabled={pending}>
                  삭제
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground">
              <span>{s.baseUrl ?? '-'}</span> · 조회 operation {s.readOpIds.length}개 · 마지막 사용{' '}
              {fmt(s.lastUsedAt)}
            </p>
            <div className="flex flex-wrap gap-1">
              {s.allowedAgentIds.length === 0 && (
                <span className="text-muted-foreground">허용된 에이전트 없음</span>
              )}
              {s.allowedAgentIds.map((id) => (
                <Badge key={id} variant="secondary">
                  {agentName(id)}
                </Badge>
              ))}
            </div>
            {s.lastError && <p className="text-destructive">{s.lastError}</p>}
            {revealed?.name === s.name && (
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 text-xs break-all">
                  {revealed.value}
                </code>
                <Button size="sm" variant="ghost" onClick={clearReveal}>
                  숨기기
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      {edit && (
        <SecretDialog
          key={edit.name || 'create'}
          initialName={edit.name}
          agents={agents}
          pending={pending}
          onClose={() => setEdit(null)}
          onSave={save}
        />
      )}
    </Card>
  )
}

const DEFAULT_READ_OPS = '[]'

function SecretDialog({
  initialName,
  agents,
  pending,
  onClose,
  onSave,
}: {
  initialName: string
  agents: AgentChoice[]
  pending: boolean
  onClose: () => void
  onSave: (name: string, payload: object) => Promise<string | null>
}) {
  const replacing = initialName !== ''
  const [name, setName] = useState(initialName)
  const [value, setValue] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [authIn, setAuthIn] = useState<'header' | 'query'>('header')
  const [authName, setAuthName] = useState('Authorization')
  const [template, setTemplate] = useState('Bearer {value}')
  const [readOps, setReadOps] = useState(DEFAULT_READ_OPS)
  const [allowed, setAllowed] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    let ops: unknown
    try {
      ops = JSON.parse(readOps)
    } catch {
      return setError('readOps가 올바른 JSON이 아닙니다')
    }
    const auth =
      authIn === 'header'
        ? { in: 'header', name: authName.trim(), template }
        : { in: 'query', name: authName.trim() }
    const message = await onSave(name.trim(), {
      value,
      config: { baseUrl: baseUrl.trim(), auth, readOps: ops },
      allowedAgentIds: allowed,
    })
    // 성공하면 대화상자가 닫히며 입력 state(값 포함)가 사라진다. 실패하면 값은 남겨 다시 시도할 수 있게 한다.
    if (message !== null) setError(message)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{replacing ? `비밀값 교체 — ${initialName}` : '비밀값 등록'}</DialogTitle>
          <DialogDescription>
            값은 저장 뒤 다시 보려면 MFA 인증이 필요합니다. 교체하면 설정 전체가 새로 저장됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Field label="이름">
            <Input
              id="secret-name"
              value={name}
              readOnly={replacing}
              placeholder="MY_API_KEY"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="값">
            <Input
              id="secret-value"
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Field label="baseUrl">
            <Input
              id="secret-baseurl"
              placeholder="https://api.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="secret-auth-in">인증 위치</Label>
              <select
                id="secret-auth-in"
                className="h-9 rounded-md border bg-transparent px-2"
                value={authIn}
                onChange={(e) => setAuthIn(e.target.value as 'header' | 'query')}
              >
                <option value="header">header</option>
                <option value="query">query</option>
              </select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="secret-auth-name">인증 이름</Label>
              <Input
                id="secret-auth-name"
                value={authName}
                onChange={(e) => setAuthName(e.target.value)}
              />
            </div>
          </div>
          {authIn === 'header' && (
            <Field label="template">
              <Input
                id="secret-template"
                className="font-mono"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              />
            </Field>
          )}
          <Field label="readOps(JSON)">
            <Textarea
              id="secret-readops"
              className="min-h-32 font-mono text-xs"
              value={readOps}
              onChange={(e) => setReadOps(e.target.value)}
            />
          </Field>
          <div className="space-y-2">
            <p className="font-medium">허용 에이전트</p>
            {agents.length === 0 && (
              <p className="text-muted-foreground">활성 에이전트가 없습니다.</p>
            )}
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-2">
                <Checkbox
                  checked={allowed.includes(a.id)}
                  onCheckedChange={(v) =>
                    setAllowed((p) => (v === true ? [...p, a.id] : p.filter((x) => x !== a.id)))
                  }
                />
                {a.name}
              </label>
            ))}
          </div>
          {error && <p className="text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim() || !value}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactElement<{ id?: string }>
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={children.props.id}>{label}</Label>
      {children}
    </div>
  )
}
