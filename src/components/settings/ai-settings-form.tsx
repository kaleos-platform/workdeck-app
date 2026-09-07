'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type Mode = 'WORKDECK' | 'BYOK'
type Provider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI'

type Settings = {
  mode: Mode
  provider: Provider | null
  model: string | null
  hasKey: boolean
  lastVerifiedAt: string | null
  lastError: string | null
  workdeckAvailable: boolean
  usage: { yearMonth: string; textTokensUsed: number; textTokenQuota: number }
}

const PROVIDERS: { value: Provider; label: string; defaultModel: string; keyHint: string }[] = [
  { value: 'OPENAI', label: 'OpenAI', defaultModel: 'gpt-4.1-mini', keyHint: 'sk-...' },
  { value: 'ANTHROPIC', label: 'Anthropic', defaultModel: 'claude-sonnet-4-5', keyHint: 'sk-ant-...' },
  { value: 'GEMINI', label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', keyHint: 'AIza...' },
]

export function AiSettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const [mode, setMode] = useState<Mode>('WORKDECK')
  const [provider, setProvider] = useState<Provider>('OPENAI')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai', { cache: 'no-store' })
      if (!res.ok) throw new Error('설정을 불러오지 못했습니다')
      const data = (await res.json()) as Settings
      setSettings(data)
      setMode(data.mode)
      if (data.provider) setProvider(data.provider)
      setModel(data.model ?? '')
      setApiKey('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '설정을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selected = PROVIDERS.find((p) => p.value === provider)!

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/ai', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          provider: mode === 'BYOK' ? provider : undefined,
          model: mode === 'BYOK' ? model.trim() || selected.defaultModel : undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '저장에 실패했습니다')
      toast.success('AI 설정을 저장했습니다.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  async function verify() {
    setVerifying(true)
    try {
      const res = await fetch('/api/settings/ai/verify', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '연결 확인에 실패했습니다')
      if (json.ok) toast.success(`연결 성공 — ${json.provider}${json.model ? ` / ${json.model}` : ''}`)
      else toast.error(`연결 실패: ${json.error}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '연결 확인에 실패했습니다')
    } finally {
      setVerifying(false)
    }
  }

  async function disconnect() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/ai', { method: 'DELETE' })
      if (!res.ok) throw new Error('해제에 실패했습니다')
      toast.success('저장된 키를 삭제하고 워크덱 제공 AI로 전환했습니다.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '해제에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="h-24 w-full animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    )
  }

  const usage = settings?.usage
  const percent =
    usage && usage.textTokenQuota > 0
      ? Math.min(100, Math.round((usage.textTokensUsed / usage.textTokenQuota) * 100))
      : 0
  const exhausted = usage ? usage.textTokensUsed >= usage.textTokenQuota : false

  return (
    <div className="space-y-6">
      {/* 모드 선택 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ModeCard
          active={mode === 'WORKDECK'}
          onClick={() => setMode('WORKDECK')}
          icon={<Sparkles className="h-5 w-5" />}
          title="워크덱 제공 AI"
          description="따로 준비할 것 없이 바로 사용합니다. 매월 무료 사용량이 주어집니다."
        />
        <ModeCard
          active={mode === 'BYOK'}
          onClick={() => setMode('BYOK')}
          icon={<KeyRound className="h-5 w-5" />}
          title="내 AI 키 사용"
          description="보유한 OpenAI·Anthropic·Gemini 키를 연결합니다. 사용량 제한이 없고 비용은 직접 부담합니다."
        />
      </div>

      {mode === 'WORKDECK' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">이번 달 사용량</CardTitle>
            <CardDescription>{usage?.yearMonth} 기준 · 매월 1일 초기화</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={percent} className="h-2" />
            <p className="text-sm text-muted-foreground">
              {usage?.textTokensUsed.toLocaleString()} / {usage?.textTokenQuota.toLocaleString()} 토큰
              사용
            </p>
            {exhausted && (
              <p className="text-sm text-destructive">
                이번 달 무료 사용량을 모두 썼습니다. 내 AI 키를 연결하면 제한 없이 사용할 수
                있습니다.
              </p>
            )}
            {settings && !settings.workdeckAvailable && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                워크덱 제공 AI가 아직 구성되지 않았습니다. 내 AI 키를 연결해주세요.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {mode === 'BYOK' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI 키 연결</CardTitle>
            <CardDescription>
              키는 암호화해 저장하며 저장 후에는 다시 조회할 수 없습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>공급자</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-model">모델</Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={selected.defaultModel}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ai-key">API 키</Label>
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings?.hasKey ? '••••••••  (변경할 때만 입력)' : selected.keyHint}
              />
              {settings?.hasKey && (
                <p className="text-xs text-muted-foreground">
                  키가 저장되어 있습니다. 비워두면 기존 키를 그대로 사용합니다.
                </p>
              )}
            </div>

            {settings?.lastVerifiedAt && !settings.lastError && (
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                {new Date(settings.lastVerifiedAt).toLocaleString('ko-KR')} 연결 확인됨
              </Badge>
            )}
            {settings?.lastError && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                마지막 오류: {settings.lastError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          저장
        </Button>
        {settings?.hasKey && (
          <>
            <Button variant="outline" onClick={verify} disabled={verifying || saving}>
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              연결 테스트
            </Button>
            <Button variant="ghost" onClick={disconnect} disabled={saving}>
              키 삭제하고 워크덱 AI 사용
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border p-4 text-left transition',
        active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-muted-foreground/40'
      )}
      aria-pressed={active}
    >
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
    </button>
  )
}
