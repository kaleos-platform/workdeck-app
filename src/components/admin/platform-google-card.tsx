'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { CopyCodeBlock } from '@/components/integrations/copy-code-block'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'
import { buildAdminUrl } from '@/lib/domain'
import type { PlatformGoogleView } from '@/lib/admin/platform-ga4'

const RESULT: Record<string, { title: string; ok: boolean }> = {
  connected: { title: 'Google 연결이 완료되었습니다', ok: true },
  denied: { title: 'Google 승인을 취소했습니다', ok: false },
  error: {
    title: 'Google 연결에 실패했습니다. 클라이언트 정보를 확인하고 다시 시도해 주세요',
    ok: false,
  },
  scope_missing: {
    title: '필요한 권한(analytics.readonly)이 승인되지 않았습니다. 다시 연결해 주세요',
    ok: false,
  },
  property_denied: {
    title:
      '연결은 됐지만 GA4 스트림에 접근하지 못했습니다. 승인한 구글 계정의 속성 권한을 확인해 주세요',
    ok: false,
  },
  mfa_required: { title: '2단계 인증이 필요합니다. 인증 후 다시 연결해 주세요', ok: false },
  forbidden: { title: '권한이 없거나 승인을 시작한 계정과 다릅니다', ok: false },
  expired: {
    title: '승인 요청이 만료되었거나 유효하지 않습니다. 처음부터 다시 진행해 주세요',
    ok: false,
  },
}

const STATUS_LABEL = {
  needs_auth: '승인 필요',
  needs_check: '확인 필요',
  connected: '연결됨',
} as const

const ENHANCED_LABEL: Record<string, string> = {
  streamEnabled: '향상된 측정 전체',
  pageChangesEnabled: '페이지 변경(브라우저 기록 이벤트)',
  scrollsEnabled: '스크롤',
  outboundClicksEnabled: '외부 링크 클릭',
  siteSearchEnabled: '사이트 검색',
  formInteractionsEnabled: '양식 상호작용',
  videoEngagementEnabled: '동영상 참여',
  fileDownloadsEnabled: '파일 다운로드',
}

/** 오류 코드별 조치 안내 — 코드는 서버가 허용 목록으로만 남긴다. */
function errorHint(lastError: string): string | null {
  if (lastError.includes('service_disabled') || lastError.includes('api_disabled'))
    return 'OAuth 클라이언트가 속한 Google Cloud 프로젝트에서 Google Analytics Admin API·Data API를 사용 설정해 주세요.'
  if (lastError.includes('permission_denied') || lastError.includes('forbidden'))
    return '승인한 구글 계정에 이 GA4 속성의 뷰어 이상 권한이 있는지, 속성 ID·스트림 ID가 맞는지 확인해 주세요.'
  if (lastError.includes('access_token_scope_insufficient'))
    return '권한 범위가 부족합니다. 「다시 연결」로 승인해 주세요.'
  return null
}

export function PlatformGoogleCard({
  view,
  result,
}: {
  view: PlatformGoogleView
  result: string | null
}) {
  const router = useRouter()
  const [clientId, setClientId] = useState(view.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const [propertyId, setPropertyId] = useState(view.propertyId)
  const [streamId, setStreamId] = useState(view.streamId)
  const [showSecret, setShowSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const banner = result && Object.hasOwn(RESULT, result) ? RESULT[result] : undefined
  const ga4 = view.ga4

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetchWithMfa('/api/admin/platform/google', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret: clientSecret || undefined,
          propertyId,
          streamId,
        }),
      })
      if (await redirectIfMfaRequired(res)) return
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        toast.error(body?.message ?? '저장하지 못했습니다')
        return
      }
      toast.success('저장했습니다')
      setClientSecret('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function connect() {
    setBusy(true)
    try {
      const res = await fetchWithMfa('/api/admin/platform/google/install', { method: 'POST' })
      if (await redirectIfMfaRequired(res)) return
      const body = (await res.json().catch(() => null)) as { url?: string; message?: string } | null
      if (!res.ok || !body?.url) {
        toast.error(body?.message ?? '연결을 시작하지 못했습니다')
        return
      }
      window.location.assign(body.url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6 rounded-lg border p-6">
      <div>
        <h2 className="text-base font-semibold">워크덱 홈페이지 GA4</h2>
        <p className="text-sm text-muted-foreground">
          상태:{' '}
          <span className="font-medium text-foreground">
            {view.status ? STATUS_LABEL[view.status] : '미등록'}
          </span>
          {view.connectedAt ? ` · ${new Date(view.connectedAt).toLocaleString('ko-KR')}` : ''}
        </p>
      </div>

      {banner && (
        <Alert variant={banner.ok ? 'default' : 'destructive'}>
          <AlertDescription>{banner.title}</AlertDescription>
        </Alert>
      )}
      {view.lastError && (
        <Alert variant="destructive">
          <AlertDescription>
            최근 오류: {view.lastError}
            {errorHint(view.lastError) && (
              <span className="block">{errorHint(view.lastError)}</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pg-client-id">클라이언트 ID</Label>
          <Input
            id="pg-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="예: 1234567890-abcd….apps.googleusercontent.com"
            required
          />
          <p className="text-xs text-muted-foreground">
            운영사 전용 OAuth 클라이언트를 권장합니다(Google Cloud 콘솔 → API 및 서비스 → 사용자
            인증 정보).
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pg-client-secret">클라이언트 시크릿</Label>
          <div className="relative">
            <Input
              id="pg-client-secret"
              type={showSecret ? 'text' : 'password'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={view.registered ? '저장됨 — 바꿀 때만 입력' : '예: GOCSPX-…'}
              autoComplete="off"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              aria-label={showSecret ? '시크릿 숨기기' : '시크릿 보기'}
              className="absolute inset-y-0 right-2 text-muted-foreground"
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pg-property">GA4 속성 ID</Label>
            <Input
              id="pg-property"
              inputMode="numeric"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              placeholder="예: 412345678"
              required
            />
            <p className="text-xs text-muted-foreground">
              GA4 관리 → 속성 세부정보의 숫자. 측정 ID(G-)가 아닙니다.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pg-stream">웹 스트림 ID</Label>
            <Input
              id="pg-stream"
              inputMode="numeric"
              value={streamId}
              onChange={(e) => setStreamId(e.target.value)}
              placeholder="예: 9876543210"
              required
            />
            <p className="text-xs text-muted-foreground">
              관리 → 데이터 스트림 → 스트림 세부정보의 숫자
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}저장
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !view.registered}
            onClick={connect}
          >
            {view.hasRefreshToken ? '다시 연결' : 'Google로 연결'}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Google Cloud에 등록할 승인된 리디렉션 URI</p>
        <CopyCodeBlock code={buildAdminUrl('/api/admin/platform/google/callback')} />
      </div>

      {view.status === 'connected' && ga4 && (
        <div className="flex flex-col gap-4 border-t pt-4">
          {ga4.errors.map((e) => (
            <Alert key={e} variant="destructive">
              <AlertDescription>{e}</AlertDescription>
            </Alert>
          ))}
          <p className="text-sm">
            측정 ID: <span className="font-mono">{ga4.measurementId ?? '확인 불가'}</span>
          </p>
          {ga4.enhanced && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">향상된 측정</p>
              <p
                className={
                  ga4.enhanced.streamEnabled
                    ? 'text-xs font-medium text-amber-600 dark:text-amber-400'
                    : 'text-xs text-emerald-600 dark:text-emerald-400'
                }
              >
                {ga4.enhanced.streamEnabled
                  ? 'GA4 퍼널 운영 게이트: 미통과 — 향상된 측정 전체 스위치를 꺼야 측정 ID를 등록할 수 있습니다'
                  : 'GA4 퍼널 운영 게이트: 통과 — 향상된 측정 전체가 꺼져 있습니다'}
              </p>
              <ul className="text-sm">
                {Object.entries(ga4.enhanced).map(([k, v]) => {
                  // 전체가 꺼져 있으면 하위 값은 저장만 돼 있고 동작하지 않는다
                  const active = k === 'streamEnabled' ? v : ga4.enhanced!.streamEnabled && v
                  return (
                    <li
                      key={k}
                      className={
                        active
                          ? 'font-medium text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground'
                      }
                    >
                      {ENHANCED_LABEL[k] ?? k}: {v ? '켜짐' : '꺼짐'}
                      {k !== 'streamEnabled' && v && !ga4.enhanced!.streamEnabled
                        ? ' (전체 꺼짐 — 동작 안 함)'
                        : ''}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {ga4.funnel && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">최근 {ga4.funnel.days}일 퍼널</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 font-normal">이벤트</th>
                    <th className="py-1 text-right font-normal">횟수</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ga4.funnel.events).map(([name, n]) => (
                    <tr key={name} className="border-b">
                      <td className="py-1 font-mono text-xs">{name}</td>
                      <td className="py-1 text-right">{n.toLocaleString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ga4.funnel.sources.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1 font-normal">유입(소스 / 매체)</th>
                      <th className="py-1 text-right font-normal">가입</th>
                      <th className="py-1 text-right font-normal">구독</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ga4.funnel.sources.map((s) => (
                      <tr key={`${s.source}/${s.medium}`} className="border-b">
                        <td className="py-1">
                          {s.source} / {s.medium}
                        </td>
                        <td className="py-1 text-right">{s.signUp}</td>
                        <td className="py-1 text-right">{s.subscribe}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
