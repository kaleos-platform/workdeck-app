'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useCurrentSpace } from '@/hooks/use-current-space'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'

type Cafe24StatusResponse = {
  configured: boolean
  mallId: string | null
  status: 'needs_auth' | 'connected' | 'reauth_required' | null
  connectedAt: string | null
  scopes: string[]
  error: string | null
}

const RESULT_MESSAGE: Record<string, { title: string; variant: 'default' | 'destructive' }> = {
  connected: { title: '카페24 연결이 완료되었습니다', variant: 'default' },
  denied: { title: '카페24 승인을 취소했습니다', variant: 'destructive' },
  error: {
    title: '카페24 연결에 실패했습니다. 앱 정보를 확인하고 다시 시도해 주세요',
    variant: 'destructive',
  },
  mall_mismatch: {
    title: '승인한 쇼핑몰이 입력한 쇼핑몰 ID와 다릅니다. 쇼핑몰 ID를 확인해 주세요',
    variant: 'destructive',
  },
  scope_missing: {
    title: '주문 읽기·쓰기 권한이 승인되지 않았습니다. 카페24 앱의 권한 설정을 확인해 주세요',
    variant: 'destructive',
  },
  mfa_required: {
    title: '2단계 인증이 필요합니다. 「다시 승인」을 눌러 인증한 뒤 진행해 주세요',
    variant: 'destructive',
  },
  forbidden: {
    title:
      '이 작업 공간의 관리자 권한이 없거나 승인을 시작한 계정과 다릅니다. 같은 계정으로 다시 시도해 주세요',
    variant: 'destructive',
  },
  expired: {
    title:
      '승인 요청이 만료되었거나 유효하지 않습니다. 「다시 승인」을 눌러 처음부터 진행해 주세요',
    variant: 'destructive',
  },
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null
  return typeof body?.message === 'string' ? body.message : fallback
}

export function Cafe24ConnectCard({
  result,
  onChanged,
  embedded = false,
}: {
  /** OAuth 복귀 결과(?cafe24=) */
  result: string | null
  onChanged?: () => void
  embedded?: boolean
}) {
  const space = useCurrentSpace()
  const spaceId = space?.id
  const [data, setData] = useState<Cafe24StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [mallId, setMallId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!spaceId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/integrations/cafe24/status?spaceId=${encodeURIComponent(spaceId)}`
      )
      const json: Cafe24StatusResponse | null = res.ok ? await res.json() : null
      setData(json)
      if (json?.mallId) setMallId(json.mallId)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [spaceId])

  useEffect(() => {
    load()
  }, [load])

  // 서버가 Origin·권한·2단계 인증을 확인하고 카페24 승인 주소를 준다. 인증이 만료됐으면 제자리에서 다시 인증한다.
  async function handleInstall() {
    if (!spaceId) return
    setStarting(true)
    setError(null)
    try {
      const body = new FormData()
      body.set('spaceId', spaceId)
      const res = await fetchWithMfa('/api/integrations/cafe24/install', { method: 'POST', body })
      if (await redirectIfMfaRequired(res)) return
      const json = (await res.json().catch(() => null)) as { url?: string } | null
      if (!res.ok || !json?.url) {
        setError(await errorMessage(res, '카페24 승인을 시작하지 못했습니다'))
        return
      }
      window.location.assign(json.url)
    } catch {
      setError('카페24 승인을 시작하지 못했습니다')
    } finally {
      setStarting(false)
    }
  }

  async function handleSave() {
    if (!spaceId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetchWithMfa(
        `/api/spaces/${encodeURIComponent(spaceId)}/credentials/cafe24`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: { clientId: clientId.trim(), clientSecret: clientSecret.trim() },
            config: { mallId: mallId.trim().toLowerCase() },
          }),
        }
      )
      if (await redirectIfMfaRequired(res)) return
      if (!res.ok) {
        setError(
          res.status === 400
            ? '입력값을 확인해 주세요. 쇼핑몰 ID는 영문 소문자·숫자·하이픈입니다'
            : await errorMessage(res, '저장하지 못했습니다')
        )
        return
      }
      setClientId('')
      setClientSecret('')
      setEditing(false)
      await load()
      onChanged?.()
    } catch {
      setError('저장하지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  const toast = result ? RESULT_MESSAGE[result] : null
  const showForm = editing || !data?.configured
  const status = data?.status

  return (
    <Card className={embedded ? 'border-0 bg-transparent py-0 shadow-none' : undefined}>
      <CardContent className={embedded ? 'space-y-4 px-0' : 'space-y-4'}>
        {toast && (
          <Alert variant={toast.variant}>
            {toast.variant === 'destructive' ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <AlertTitle>{toast.title}</AlertTitle>
          </Alert>
        )}

        {loading || !spaceId ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {data?.configured && !editing && (
              <div className="space-y-3">
                <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">쇼핑몰</p>
                    <p className="mt-1 text-sm font-medium">{data.mallId}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">상태</p>
                    <p className="mt-1 text-sm font-medium">
                      {status === 'connected'
                        ? '연결됨'
                        : status === 'reauth_required'
                          ? '다시 승인 필요'
                          : '승인 필요'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">승인일</p>
                    <p className="mt-1 text-sm font-medium">
                      {data.connectedAt
                        ? new Date(data.connectedAt).toLocaleDateString('ko-KR')
                        : '-'}
                    </p>
                  </div>
                </div>
                {status === 'connected' && data.scopes.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    승인된 권한: {data.scopes.join(', ')}
                  </p>
                )}
                {data.error && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>최근 오류</AlertTitle>
                    <AlertDescription>{data.error}</AlertDescription>
                  </Alert>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={status === 'connected' ? 'outline' : 'default'}
                    disabled={starting}
                    onClick={handleInstall}
                  >
                    {starting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    {status === 'connected' ? '다시 승인' : '카페24에서 승인'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    앱 정보 수정
                  </Button>
                </div>
              </div>
            )}

            {showForm && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  카페24 개발자센터에서 만든 앱의 정보를 입력하세요. 저장한 뒤 「카페24에서 승인」을
                  누르면 쇼핑몰 관리자 승인 화면으로 이동합니다.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="cafe24-mall-id">쇼핑몰 ID</Label>
                  <Input
                    id="cafe24-mall-id"
                    placeholder="myshop24"
                    value={mallId}
                    onChange={(e) => setMallId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cafe24-client-id">클라이언트 ID (client_id)</Label>
                  <Input
                    id="cafe24-client-id"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cafe24-client-secret">클라이언트 시크릿 (client_secret)</Label>
                  <Input
                    id="cafe24-client-secret"
                    type="password"
                    autoComplete="off"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={saving || !mallId.trim() || !clientId.trim() || !clientSecret.trim()}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        저장 중...
                      </>
                    ) : space?.name ? (
                      `「${space.name}」에 저장`
                    ) : (
                      '저장'
                    )}
                  </Button>
                  {data?.configured && (
                    <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                      취소
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
