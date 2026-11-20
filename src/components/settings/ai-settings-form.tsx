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
import { cn } from '@/lib/utils'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'

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

// logo: 공식 브랜드 SVG를 public/brand/에 둔 공급자만 지정한다(없으면 이름 텍스트 타일).
const PROVIDERS: {
  value: Provider
  label: string
  defaultModel: string
  keyHint: string
  logo?: string
  keyUrl: string
  keySteps: string[]
}[] = [
  {
    value: 'OPENAI',
    label: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    keyHint: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    keySteps: ['OpenAI 계정으로 로그인합니다.', '"Create new secret key"를 눌러 키를 만듭니다.'],
  },
  {
    value: 'ANTHROPIC',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-5',
    keyHint: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keySteps: ['Anthropic 콘솔에 로그인합니다.', '"Create Key"를 눌러 키를 만듭니다.'],
  },
  {
    value: 'GEMINI',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    keyHint: 'AIza...',
    keyUrl: 'https://aistudio.google.com/apikey',
    keySteps: ['Google 계정으로 로그인합니다.', '"Create API key"를 눌러 키를 만듭니다.'],
  },
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
  // 표시는 입력 중인 값 기준, 직접 입력 펼침의 초기값만 저장값 기준.
  const savedModel = settings?.model?.trim() ?? ''
  const typedModel = model.trim()
  const customModel = typedModel !== '' && typedModel !== selected.defaultModel
  const savedCustom = savedModel !== '' && savedModel !== selected.defaultModel

  async function save() {
    setSaving(true)
    try {
      const res = await fetchWithMfa('/api/settings/ai', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          provider: mode === 'BYOK' ? provider : undefined,
          model: mode === 'BYOK' ? model.trim() || selected.defaultModel : undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      })
      if (await redirectIfMfaRequired(res)) return
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
      if (json.ok)
        toast.success(`연결 성공 — ${json.provider}${json.model ? ` / ${json.model}` : ''}`)
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
      const res = await fetchWithMfa('/api/settings/ai', { method: 'DELETE' })
      if (await redirectIfMfaRequired(res)) return
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
            <CardTitle className="text-base">이번 달 무료 사용량 {percent}% 사용</CardTitle>
            <CardDescription>{usage?.yearMonth} 기준 · 매월 1일 초기화</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={percent} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {usage?.textTokensUsed.toLocaleString()} / {usage?.textTokenQuota.toLocaleString()}{' '}
              토큰 사용
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
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">AI 회사</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {PROVIDERS.map((p) => (
                  <label
                    key={p.value}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                      provider === p.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:border-muted-foreground/40'
                    )}
                  >
                    <input
                      type="radio"
                      name="ai-provider"
                      className="sr-only"
                      value={p.value}
                      checked={provider === p.value}
                      onChange={() => {
                        // 추천값·빈 값은 새 공급자의 추천값으로, 직접 입력한 값은 유지
                        if (typedModel === '' || typedModel === selected.defaultModel) setModel('')
                        setProvider(p.value)
                      }}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element -- 작은 정적 SVG 로고 */}
                    {p.logo && <img src={p.logo} alt="" width={20} height={20} />}
                    {p.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <details className="rounded-md border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">키는 어디서 받나요?</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                {selected.keySteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
                <li>
                  만든 키를 복사해 아래 칸에 붙여넣습니다.{' '}
                  <a
                    href={selected.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    {selected.label} 키 발급 페이지 열기
                  </a>
                </li>
              </ol>
            </details>

            <div className="space-y-1.5">
              <Label>모델</Label>
              {customModel ? (
                <p className="text-sm">사용 중인 모델: {typedModel}(직접 입력)</p>
              ) : (
                <p className="text-sm">추천 모델 사용({selected.defaultModel})</p>
              )}
              <details key={savedModel} open={savedCustom} className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">직접 입력</summary>
                <Input
                  id="ai-model"
                  aria-label="모델 이름"
                  className="mt-2"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={selected.defaultModel}
                />
              </details>
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
        active
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'hover:border-muted-foreground/40'
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
