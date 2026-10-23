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
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'

type SecretConfig = {
  baseUrl: string
  auth: { in: 'header'; name: string; template: string } | { in: 'query'; name: string }
  readOps: unknown[]
}
type EnvSecretConfig = { envName: string; scopeNote: string; expiresAt: string }
type SecretMeta = {
  name: string
  kind: 'API_KEY' | 'ENV'
  // 비밀이 아닌 설정 — 교체 대화상자를 미리 채운다(값은 오지 않는다).
  config: SecretConfig | EnvSecretConfig | null
  baseUrl: string | null
  readOpIds: string[]
  allowedAgentIds: string[]
  lastUsedAt: string | null
  lastError: string | null
}
type AgentChoice = { id: string; name: string; status?: string; kind?: string }

const NET_ERR = '네트워크 오류로 요청하지 못했습니다.'
const REVEAL_MS = 30_000
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('ko-KR') : '-')
// 만료일은 KST 기준 날짜로 보인다(저장은 그날 23:59:59 KST).
const kstDate = (iso: string) =>
  new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const secretPath = (spaceId: string, name: string) =>
  `/api/spaces/${spaceId}/secrets/${encodeURIComponent(name)}`

export function SpaceSecretsCard() {
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const [spaceName, setSpaceName] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<SecretMeta[]>([])
  const [agents, setAgents] = useState<AgentChoice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // wd run 허용 설정 — ADMIN 미만은 403이라 canManage=false로 두고 스위치를 숨긴다.
  const [envSetting, setEnvSetting] = useState({ envSecretsEnabled: false, canManage: false })
  // 등록(빈 이름)·교체(기존 메타) 대화상자
  const [edit, setEdit] = useState<{ name: string; initial?: SecretMeta } | null>(null)
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
      const [sr, ar, er] = await Promise.all([
        fetch(`/api/spaces/${body.spaceId}/secrets`),
        fetch(`/api/spaces/${body.spaceId}/agents`),
        fetch(`/api/spaces/${body.spaceId}/env-secrets`),
      ])
      const eb = await er.json().catch(() => null)
      if (er.ok && eb)
        setEnvSetting({ envSecretsEnabled: !!eb.envSecretsEnabled, canManage: !!eb.canManage })
      const sb = await sr.json().catch(() => null)
      if (!sr.ok) return setError(sb?.message ?? '비밀값 목록을 불러오지 못했습니다')
      setSecrets(sb.secrets)
      const ab = await ar.json().catch(() => null)
      // 이름 조회용 전체 목록 — PUT은 ACTIVE만 받으므로 대화상자 선택지만 거른다.
      if (ar.ok) setAgents(ab.agents as AgentChoice[])
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

  async function toggleEnv(enabled: boolean) {
    setError(null)
    const r = await call(
      `/api/spaces/${spaceId}/env-secrets`,
      { method: 'PATCH', body: JSON.stringify({ envSecretsEnabled: enabled }) },
      'wd run 허용 설정을 바꾸지 못했습니다'
    )
    if (!r.ok) return r.message && setError(r.message)
    setEnvSetting({ envSecretsEnabled: !!r.body.envSecretsEnabled, canManage: !!r.body.canManage })
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
        <div className="flex flex-wrap items-center gap-4">
          <Button size="sm" onClick={() => setEdit({ name: '' })} disabled={!spaceId}>
            비밀값 등록
          </Button>
          {envSetting.canManage && (
            <label className="flex items-center gap-2">
              <Switch
                checked={envSetting.envSecretsEnabled}
                onCheckedChange={toggleEnv}
                disabled={pending}
              />
              wd run 허용(개발 키 발급)
            </label>
          )}
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEdit({ name: s.name, initial: s })}
                >
                  교체
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s.name)} disabled={pending}>
                  삭제
                </Button>
              </div>
            </div>
            {s.kind === 'ENV' && s.config && 'envName' in s.config ? (
              <p className="text-muted-foreground">
                <span className="font-mono">{s.config.envName}</span> ·{' '}
                <span>만료 {kstDate(s.config.expiresAt)}</span>
                {new Date(s.config.expiresAt) < new Date() && (
                  <span className="ml-1 text-muted-foreground">만료됨</span>
                )}{' '}
                · 마지막 사용 {fmt(s.lastUsedAt)}
              </p>
            ) : (
              <p className="text-muted-foreground">
                <span>{s.baseUrl ?? '-'}</span> · 조회 operation {s.readOpIds.length}개 · 마지막
                사용 {fmt(s.lastUsedAt)}
              </p>
            )}
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
          initial={edit.initial}
          agents={agents.filter((a) => a.status === 'ACTIVE')}
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
  initial,
  agents,
  pending,
  onClose,
  onSave,
}: {
  initialName: string
  initial?: SecretMeta
  agents: AgentChoice[]
  pending: boolean
  onClose: () => void
  onSave: (name: string, payload: object) => Promise<string | null>
}) {
  const replacing = initialName !== ''
  const [name, setName] = useState(initialName)
  const [value, setValue] = useState('')
  // 교체면 기존 설정으로 미리 채운다. 값은 다시 입력해야 한다.
  const [kind, setKind] = useState<'API_KEY' | 'ENV'>(initial?.kind ?? 'API_KEY')
  const cfg = initial?.config && 'baseUrl' in initial.config ? initial.config : undefined
  const envCfg = initial?.config && 'envName' in initial.config ? initial.config : undefined
  const [envName, setEnvName] = useState(envCfg?.envName ?? '')
  const [scopeNote, setScopeNote] = useState(envCfg?.scopeNote ?? '')
  const [expiresDate, setExpiresDate] = useState(envCfg ? kstDate(envCfg.expiresAt) : '')
  const [confirmed, setConfirmed] = useState(false)
  const [baseUrl, setBaseUrl] = useState(cfg?.baseUrl ?? '')
  const [authIn, setAuthIn] = useState<'header' | 'query'>(cfg?.auth.in ?? 'header')
  const [authName, setAuthName] = useState(cfg?.auth.name ?? 'Authorization')
  const [template, setTemplate] = useState(
    cfg?.auth.in === 'header' ? cfg.auth.template : 'Bearer {value}'
  )
  const [readOps, setReadOps] = useState(
    cfg ? JSON.stringify(cfg.readOps, null, 2) : DEFAULT_READ_OPS
  )
  // 선택지(ACTIVE)에 없는 id는 해제할 수 없고 PUT이 거부하므로 빼고 시작한다.
  const [allowed, setAllowed] = useState<string[]>(
    (initial?.allowedAgentIds ?? []).filter((id) => agents.some((a) => a.id === id))
  )
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (kind === 'ENV') {
      const message = await onSave(name.trim(), {
        kind: 'ENV',
        value,
        config: {
          envName: envName.trim(),
          scopeNote: scopeNote.trim(),
          expiresAt: new Date(`${expiresDate}T23:59:59+09:00`).toISOString(),
          readOnlyConfirmed: true,
        },
        // API_KEY 모드에서 고른 integration이 ENV로 넘어가지 않게 거른다.
        allowedAgentIds: allowed.filter((id) => agents.find((a) => a.id === id)?.kind === 'agent'),
      })
      if (message !== null) setError(message)
      return
    }
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
            값은 저장 뒤 다시 보려면 MFA 인증이 필요합니다.
            {replacing && ' 교체할 때는 값을 다시 입력하세요. 설정은 기존 값으로 채워져 있습니다.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {!replacing && (
            <Field label="종류">
              <select
                id="secret-kind"
                className="h-9 w-full rounded-md border bg-transparent px-2"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'API_KEY' | 'ENV')}
              >
                <option value="API_KEY">API 키</option>
                <option value="ENV">개발 키(wd run)</option>
              </select>
            </Field>
          )}
          <Field label="이름">
            <Input
              id="secret-name"
              value={name}
              readOnly={replacing}
              placeholder="my-api-key"
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
          {kind === 'API_KEY' ? (
            <>
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
            </>
          ) : (
            <>
              <Field label="환경변수 이름">
                <Input
                  id="secret-envname"
                  className="font-mono"
                  placeholder="VERCEL_READ_TOKEN"
                  value={envName}
                  onChange={(e) => setEnvName(e.target.value)}
                />
              </Field>
              <Field label="용도">
                <Input
                  id="secret-scopenote"
                  value={scopeNote}
                  onChange={(e) => setScopeNote(e.target.value)}
                />
              </Field>
              <Field label="만료일">
                <Input
                  id="secret-expires"
                  type="date"
                  value={expiresDate}
                  onChange={(e) => setExpiresDate(e.target.value)}
                />
              </Field>
              <label className="flex items-start gap-2">
                <Checkbox
                  className="mt-0.5"
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                />
                이 키는 읽기 전용이고 대상이 한정돼 있음을 확인했습니다. Supabase service role, 운영
                DB URL, ENCRYPTION_KEY, Vercel·GitHub 쓰기 토큰 같은 쓰기 키는 등록하지 마세요.
              </label>
            </>
          )}
          <div className="space-y-2">
            <p className="font-medium">허용 에이전트</p>
            {agents.length === 0 && (
              <p className="text-muted-foreground">활성 에이전트가 없습니다.</p>
            )}
            {agents
              .filter((a) => kind !== 'ENV' || a.kind === 'agent')
              .map((a) => (
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
          <Button
            onClick={submit}
            disabled={
              pending ||
              !name.trim() ||
              !value ||
              (kind === 'ENV' &&
                (!envName.trim() || !scopeNote.trim() || !expiresDate || !confirmed))
            }
          >
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
