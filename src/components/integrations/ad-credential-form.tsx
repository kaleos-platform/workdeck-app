'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Plus, Trash2 } from 'lucide-react'
import { CopyCodeBlock } from '@/components/integrations/copy-code-block'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'
import { APPROVALS_PATH } from '@/lib/deck-routes'
import { buildAppUrl } from '@/lib/domain'

type Provider = 'meta-ads' | 'google-marketing' | 'naver-searchad'
/** placeholder = 입력 예시, hint = 어디서 찾는 값인지 안내 */
type Field = { key: string; label: string; optional?: boolean; placeholder?: string; hint?: string }
type Def = {
  /** 브랜드별 행 묶음 제목·설명·브랜드 이름 예시 */
  rowsTitle?: string
  rowsHint?: string
  brandPlaceholder?: string
  secrets: Field[]
  /** 네이버처럼 브랜드와 무관한 공통 설정 칸 */
  shared?: Field
  columns: Field[]
  digits: RegExp
  digitsMessage: string
  max: number
  build: (
    secrets: Record<string, string>,
    shared: string,
    rows: Row[],
    defaultBrand: string
  ) => { secret: Record<string, string>; config: Record<string, unknown> }
  /** 서버 config → 행 칸 값 */
  read: (config: Record<string, unknown>) => {
    shared: string
    rows: [string, Record<string, string>][]
  }
}
type Row = { id: number; brand: string; cols: Record<string, string> }
type Loaded = {
  registered: boolean
  config: Record<string, unknown> | null
  lastVerifiedAt: string | null
  hasError: boolean
  pendingActions: number
  /** 구글: 서버가 계산한 refresh token 보유 여부(값은 내려오지 않는다) */
  hasRefreshToken?: boolean
}

// 「Google로 연결」 OAuth 복귀 결과(?google=)
const GOOGLE_RESULT: Record<string, { title: string; ok: boolean }> = {
  connected: { title: 'Google 연결이 완료되었습니다', ok: true },
  denied: { title: 'Google 승인을 취소했습니다', ok: false },
  error: {
    title: 'Google 연결에 실패했습니다. 클라이언트 정보를 확인하고 다시 시도해 주세요',
    ok: false,
  },
  scope_missing: {
    title:
      '필요한 권한이 모두 승인되지 않았습니다. 「다시 연결」을 눌러 모든 권한 항목을 허용해 주세요',
    ok: false,
  },
  property_denied: {
    title:
      '연결은 됐지만 GA4 속성에 접근하지 못했습니다. 승인한 구글 계정에 속성 권한이 있는지 확인해 주세요',
    ok: false,
  },
  mfa_required: {
    title: '2단계 인증이 필요합니다. 「다시 연결」을 눌러 인증한 뒤 진행해 주세요',
    ok: false,
  },
  forbidden: {
    title:
      '이 작업 공간의 관리자 권한이 없거나 승인을 시작한 계정과 다릅니다. 같은 계정으로 다시 시도해 주세요',
    ok: false,
  },
  expired: {
    title:
      '승인 요청이 만료되었거나 유효하지 않습니다. 「다시 연결」을 눌러 처음부터 진행해 주세요',
    ok: false,
  },
}

const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v : '')

const DEFS: Record<Provider, Def> = {
  'meta-ads': {
    secrets: [
      {
        key: 'accessToken',
        label: '액세스 토큰',
        placeholder: '예: EAAG… 로 시작하는 시스템 사용자 토큰',
      },
      { key: 'appSecret', label: '앱 시크릿', placeholder: 'Meta 앱 설정 → 기본 설정의 앱 시크릿' },
    ],
    brandPlaceholder: '예: 에이엠엘',
    columns: [
      {
        key: 'adAccount',
        label: '광고 계정 ID',
        placeholder: '예: act_1234567890',
        hint: '광고 관리자 주소의 act= 뒤 숫자',
      },
    ],
    digits: /^(act_)?\d+$/,
    digitsMessage: '숫자만 입력해 주세요(act_ 로 시작해도 됩니다)',
    max: 20,
    build: (secrets, _s, rows, defaultBrand) => ({
      secret: { accessToken: secrets.accessToken, appSecret: secrets.appSecret },
      config: {
        defaultBrand,
        adAccounts: Object.fromEntries(rows.map((r) => [r.brand, r.cols.adAccount])),
      },
    }),
    read: (c) => ({
      shared: '',
      rows: Object.entries(rec(c.adAccounts)).map(([b, id]) => [b, { adAccount: str(id) }]),
    }),
  },
  'google-marketing': {
    secrets: [
      {
        key: 'clientId',
        label: '클라이언트 ID',
        placeholder: '예: 1234567890-abcd….apps.googleusercontent.com',
        hint: 'Google Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보의 OAuth 클라이언트',
      },
      { key: 'clientSecret', label: '클라이언트 시크릿', placeholder: '예: GOCSPX-…' },
    ],
    rowsTitle: '연결할 GA4 속성',
    rowsHint:
      '이 연결로 조회할 GA4 속성을 적습니다. 브랜드 이름은 에이전트가 어느 속성을 쓸지 고를 때 부르는 별칭입니다.',
    brandPlaceholder: '예: 우리 쇼핑몰',
    columns: [
      {
        key: 'ga4_property_id',
        label: 'GA4 속성 ID',
        placeholder: '예: 412345678',
        hint: 'GA4 관리 → 속성 세부정보의 숫자. 측정 ID(G-로 시작)가 아닙니다.',
      },
      {
        key: 'gtm_account_id',
        label: '태그 관리자 계정 ID (선택)',
        optional: true,
        placeholder: '예: 6012345678',
        hint: '태그 관리자 → 관리 → 계정 설정의 숫자. 이메일이 아닙니다.',
      },
      {
        key: 'gtm_container_id',
        label: '태그 관리자 컨테이너 ID (선택)',
        optional: true,
        placeholder: '예: 198765432',
        hint: '컨테이너 설정의 숫자. GTM-로 시작하는 공개 ID가 아닙니다.',
      },
    ],
    digits: /^\d+$/,
    digitsMessage: '숫자만 입력해 주세요',
    max: 20,
    build: (secrets, _s, rows, defaultBrand) => ({
      secret: {
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
      },
      config: {
        defaultBrand,
        brands: Object.fromEntries(
          rows.map((r) => [
            r.brand,
            {
              ga4_property_id: r.cols.ga4_property_id,
              // GTM은 둘 다 입력했을 때만 보낸다(한쪽만 있는 경우는 validate 가 막는다).
              ...(r.cols.gtm_account_id && r.cols.gtm_container_id
                ? {
                    gtm_account_id: r.cols.gtm_account_id,
                    gtm_container_id: r.cols.gtm_container_id,
                  }
                : {}),
            },
          ])
        ),
      },
    }),
    read: (c) => ({
      shared: '',
      rows: Object.entries(rec(c.brands)).map(([b, v]) => [
        b,
        {
          ga4_property_id: str(rec(v).ga4_property_id),
          gtm_account_id: str(rec(v).gtm_account_id),
          gtm_container_id: str(rec(v).gtm_container_id),
        },
      ]),
    }),
  },
  'naver-searchad': {
    secrets: [
      { key: 'apiKey', label: '액세스 라이선스', placeholder: '검색광고 → 도구 → API 사용 관리' },
      { key: 'secretKey', label: '비밀 키', placeholder: '같은 화면의 비밀 키' },
    ],
    shared: { key: 'managerCustomerId', label: '관리 고객 ID', placeholder: '예: 1234567' },
    brandPlaceholder: '예: 에이엠엘',
    columns: [{ key: 'customerId', label: '광고주 고객 ID', placeholder: '예: 2345678' }],
    digits: /^\d+$/,
    digitsMessage: '숫자만 입력해 주세요',
    max: 20,
    build: (secrets, shared, rows, defaultBrand) => ({
      secret: { apiKey: secrets.apiKey, secretKey: secrets.secretKey },
      config: {
        defaultBrand,
        managerCustomerId: shared,
        customers: Object.fromEntries(rows.map((r) => [r.brand, r.cols.customerId])),
      },
    }),
    read: (c) => ({
      shared: str(c.managerCustomerId),
      rows: Object.entries(rec(c.customers)).map(([b, id]) => [b, { customerId: str(id) }]),
    }),
  },
}

let nextId = 1
const emptyRow = (def: Def): Row => ({
  id: nextId++,
  brand: '',
  cols: Object.fromEntries(def.columns.map((c) => [c.key, ''])),
})

/** 매핑(브랜드 이름·계정 ID) 비교용 — 입력값 전체를 안정된 문자열로 만든다. */
const mappingKey = (shared: string, rows: { brand: string; cols: Record<string, string> }[]) =>
  JSON.stringify([
    shared.trim(),
    rows.map((r) => [r.brand.trim(), ...Object.values(r.cols).map((v) => v.trim())]),
  ])

export function AdCredentialForm({
  provider,
  spaceId,
  onChanged,
  googleResult = null,
  navigate = (url: string) => window.location.assign(url),
}: {
  provider: Provider
  spaceId: string
  onChanged?: () => void
  /** 구글 OAuth 복귀 결과(?google=) */
  googleResult?: string | null
  /** Google 동의 화면으로 이동(테스트에서 바꿔 끼운다) */
  navigate?: (url: string) => void
}) {
  const def = DEFS[provider]
  const url = `/api/spaces/${spaceId}/credentials/${provider}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const [shared, setShared] = useState('')
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(def)])
  const [defaultId, setDefaultId] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  // 저장 직후 재조회 때 입력 중인 비밀값은 건드리지 않는다 — 행·공통 설정만 서버 값으로 덮는다.
  const baseline = useRef('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        setLoadError('설정을 불러오지 못했습니다')
        return
      }
      const data = (await res.json()) as Loaded
      setLoaded(data)
      setLoadError(null)
      if (data.registered && data.config) {
        const read = def.read(data.config)
        const next = read.rows.map(([brand, cols]) => ({ id: nextId++, brand, cols }))
        if (next.length > 0) {
          setRows(next)
          const dflt = str(data.config.defaultBrand)
          setDefaultId((next.find((r) => r.brand === dflt) ?? next[0]).id)
        }
        setShared(read.shared)
        baseline.current = mappingKey(read.shared, next.length > 0 ? next : [])
      }
    } catch {
      setLoadError('설정을 불러오지 못했습니다')
    }
  }, [url, def])

  useEffect(() => {
    load()
  }, [load])

  const effDefault = (rows.find((r) => r.id === defaultId) ?? rows[0]).id
  const currencies = rec(loaded?.config?.accountCurrencies)
  const graphVersion = str(loaded?.config?.graphVersion)

  const setRow = (id: number, patch: (r: Row) => Row) =>
    setRows((rs) => rs.map((r) => (r.id === id ? patch(r) : r)))

  function validate(): string[] {
    const out: string[] = []
    for (const f of def.secrets) {
      const v = secrets[f.key]?.trim()
      if (!v) out.push(`${f.label} 칸을 채워 주세요`)
      // 서버 스키마가 비밀값을 10자 이상으로 받는다.
      else if (v.length < 10) out.push(`${f.label}: 10자 이상이어야 합니다`)
    }
    if (def.shared) {
      if (!shared.trim()) out.push(`${def.shared.label} 칸을 채워 주세요`)
      else if (!/^\d+$/.test(shared.trim())) out.push(`${def.shared.label}: 숫자만 입력해 주세요`)
    }
    if (rows.length < 1 || rows.length > def.max)
      out.push(`브랜드는 1~${def.max}개까지 등록할 수 있습니다`)
    const names = new Set<string>()
    rows.forEach((r, i) => {
      const name = r.brand.trim()
      if (!name) out.push(`${i + 1}번째 브랜드 이름을 입력해 주세요`)
      else if (names.has(name)) out.push(`브랜드 이름이 겹칩니다: ${name}`)
      names.add(name)
      for (const c of def.columns) {
        const v = r.cols[c.key]?.trim()
        if (!v) {
          if (!c.optional) out.push(`${i + 1}번째 ${c.label} 칸을 채워 주세요`)
        } else if (!def.digits.test(v)) {
          out.push(
            `${i + 1}번째 ${c.label}: ${
              c.key === 'ga4_property_id' && /^G-/i.test(v)
                ? '측정 ID(G-…)가 아니라 GA4 관리 → 속성 세부정보의 숫자 속성 ID를 입력해 주세요'
                : def.digitsMessage
            }`
          )
        }
      }
      // 선택 칸이 여럿이면 모두 채우거나 모두 비워야 한다(GTM 계정·컨테이너).
      const opt = def.columns.filter((c) => c.optional)
      const filled = opt.filter((c) => r.cols[c.key]?.trim()).length
      if (filled > 0 && filled < opt.length) {
        out.push(`${i + 1}번째 GTM 계정 ID와 컨테이너 ID는 함께 입력하거나 함께 비워 주세요`)
      }
    })
    return out
  }

  const trimmed = () =>
    rows.map((r) => ({
      ...r,
      brand: r.brand.trim(),
      cols: Object.fromEntries(Object.entries(r.cols).map(([k, v]) => [k, v.trim()])),
    }))

  async function save() {
    setSaveError(null)
    setSaving(true)
    try {
      const rs = trimmed()
      const dflt = rs.find((r) => r.id === effDefault)!.brand
      const sec = Object.fromEntries(def.secrets.map((f) => [f.key, secrets[f.key].trim()]))
      const body = def.build(sec, shared.trim(), rs, dflt)
      const res = await fetchWithMfa(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (await redirectIfMfaRequired(res)) return
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setSaveError(
          (b as { message?: string }).message ?? `저장에 실패했습니다 (HTTP ${res.status})`
        )
        return
      }
      toast.success('저장했습니다')
      setSecrets({})
      setConfirming(false)
      await load()
      onChanged?.()
    } catch {
      setSaveError('저장 중 오류가 발생했습니다')
    } finally {
      setSaving(false)
    }
  }

  // 서버가 Origin·권한·2단계 인증을 확인하고 Google 동의 주소를 준다. 인증이 만료됐으면 제자리에서 다시 인증한다.
  async function connectGoogle() {
    setConnectError(null)
    setConnecting(true)
    try {
      const body = new FormData()
      body.set('spaceId', spaceId)
      const r = await fetchWithMfa('/api/integrations/google/install', { method: 'POST', body })
      if (await redirectIfMfaRequired(r)) return
      const json = (await r.json().catch(() => null)) as { url?: string; message?: string } | null
      if (!r.ok || !json?.url) {
        setConnectError(json?.message ?? 'Google 승인을 시작하지 못했습니다')
        return
      }
      navigate(json.url)
    } catch {
      setConnectError('Google 승인을 시작하지 못했습니다')
    } finally {
      setConnecting(false)
    }
  }

  async function submit() {
    const errs = validate()
    setErrors(errs)
    if (errs.length > 0) return
    const changed = loaded?.registered && mappingKey(shared, trimmed()) !== baseline.current
    if (changed) {
      // 본문은 페이지를 연 뒤 계속 마운트돼 있어 처음 읽은 건수가 오래됐을 수 있다 — 저장 직전에 다시 센다.
      // 입력 중인 행을 덮지 않도록 load()가 아니라 건수만 읽는다.
      const fresh = await fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<{ pendingActions?: number }>) : null))
        .catch(() => null)
      const pending = fresh?.pendingActions ?? loaded.pendingActions
      if (pending > 0) {
        setLoaded((prev) => (prev ? { ...prev, pendingActions: pending } : prev))
        setConfirming(true)
        return
      }
    }
    save()
  }

  // 확인창에서 [그래도 저장]을 누르기 전에 입력을 고쳤을 수 있다 — 다시 검사한다.
  function confirmSave() {
    const errs = validate()
    setErrors(errs)
    if (errs.length > 0) return
    save()
  }

  const verified = loaded?.lastVerifiedAt
    ? new Date(loaded.lastVerifiedAt).toLocaleString('ko-KR')
    : null

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {loaded && (
        <div className="space-y-1 text-sm">
          <p>
            <span className="font-medium">{loaded.registered ? '등록됨' : '미등록'}</span>
            {verified && <span className="text-muted-foreground"> · 마지막 확인 {verified}</span>}
          </p>
          {loaded.hasError && (
            <p className="text-destructive">
              최근 연결 확인에 실패했습니다. 키를 다시 확인해 주세요
            </p>
          )}
          {graphVersion && (
            <p className="text-xs text-muted-foreground">Graph API 버전 {graphVersion}</p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {def.secrets.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`${provider}-${f.key}`}>{f.label}</Label>
            <div className="relative">
              <Input
                id={`${provider}-${f.key}`}
                type={shown[f.key] ? 'text' : 'password'}
                autoComplete="off"
                placeholder={f.placeholder}
                className="pr-10"
                value={secrets[f.key] ?? ''}
                onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={shown[f.key] ? `${f.label} 숨기기` : `${f.label} 보기`}
                aria-pressed={!!shown[f.key]}
                onClick={() => setShown((x) => ({ ...x, [f.key]: !x[f.key] }))}
              >
                {shown[f.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          보안을 위해 저장할 때마다 키를 다시 입력합니다
        </p>
        {def.shared && (
          <div className="space-y-1.5">
            <Label htmlFor={`${provider}-${def.shared.key}`}>{def.shared.label}</Label>
            <Input
              id={`${provider}-${def.shared.key}`}
              inputMode="numeric"
              placeholder={def.shared.placeholder}
              value={shared}
              onChange={(e) => setShared(e.target.value)}
            />
          </div>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{def.rowsTitle ?? '브랜드별 계정'}</legend>
        <p className="text-xs text-muted-foreground">
          {def.rowsHint ?? '브랜드 이름은 에이전트가 어느 계정을 쓸지 고를 때 사용하는 이름입니다.'}
        </p>
        {rows.map((r, i) => (
          <div key={r.id} className="space-y-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${provider}-brand-${r.id}`}>브랜드 이름 {i + 1}</Label>
                <Input
                  id={`${provider}-brand-${r.id}`}
                  placeholder={def.brandPlaceholder}
                  value={r.brand}
                  onChange={(e) => setRow(r.id, (x) => ({ ...x, brand: e.target.value }))}
                />
              </div>
              {def.columns.map((c) => (
                <div key={c.key} className="space-y-1.5">
                  <Label htmlFor={`${provider}-${c.key}-${r.id}`}>
                    {c.label} {i + 1}
                  </Label>
                  <Input
                    id={`${provider}-${c.key}-${r.id}`}
                    inputMode="numeric"
                    placeholder={c.placeholder}
                    value={r.cols[c.key] ?? ''}
                    onChange={(e) =>
                      setRow(r.id, (x) => ({ ...x, cols: { ...x.cols, [c.key]: e.target.value } }))
                    }
                  />
                  {c.hint && <p className="text-xs text-muted-foreground">{c.hint}</p>}
                  {provider === 'meta-ads' &&
                    (() => {
                      const id = r.cols[c.key]?.trim()
                      const cur = id ? str(currencies[id] ?? currencies[`act_${id}`]) : ''
                      if (!cur) return null
                      return (
                        <p className="text-xs text-muted-foreground">
                          통화 {cur}
                          {cur !== 'KRW' && ' — 예산 제안은 원화 계정만 가능'}
                        </p>
                      )
                    })()}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${provider}-default`}
                  checked={effDefault === r.id}
                  onChange={() => setDefaultId(r.id)}
                />
                기본 브랜드
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                aria-label={`브랜드 ${i + 1} 삭제`}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                삭제
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={rows.length >= def.max}
          onClick={() => setRows((rs) => [...rs, emptyRow(def)])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />행 추가
        </Button>
      </fieldset>

      {provider === 'google-marketing' && (
        <GoogleConnect
          loaded={loaded}
          result={googleResult}
          connecting={connecting}
          error={connectError}
          onConnect={connectGoogle}
        />
      )}

      {errors.length > 0 && (
        <ul className="space-y-0.5 text-sm text-destructive" role="alert">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {confirming && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p>
              승인 대기 중인 제안 {loaded?.pendingActions}건은 바뀐 계정과 맞지 않아 실행되지
              않습니다.
            </p>
            <Link href={APPROVALS_PATH} className="text-primary underline-offset-4 hover:underline">
              AI 요청 승인 보기
            </Link>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={saving} onClick={confirmSave}>
                그래도 저장
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                취소
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      {!confirming && (
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          저장
        </Button>
      )}
    </form>
  )
}

const GOOGLE_STATUS_LABEL = {
  connected: '연결됨',
  needs_check: '연결 확인 중',
  needs_auth: '승인 필요',
} as const

/** 구글 연결 상태 줄 + 「Google로 연결」 버튼 + 등록할 리디렉션 주소. 저장한 뒤에만 연결할 수 있다. */
function GoogleConnect({
  loaded,
  result,
  connecting,
  error,
  onConnect,
}: {
  loaded: Loaded | null
  result: string | null
  connecting: boolean
  error: string | null
  onConnect: () => void
}) {
  const cfg = rec(loaded?.config)
  const status = str(cfg.status) as keyof typeof GOOGLE_STATUS_LABEL | ''
  const hasToken = loaded?.hasRefreshToken === true
  // status 가 없는 기존 행(수동 토큰)은 토큰이 있으면 연결됨.
  const shown = status || (hasToken ? 'connected' : 'needs_auth')
  const connectedAt = str(cfg.connectedAt)
  const scopes = Array.isArray(cfg.scopes) ? (cfg.scopes as string[]) : []
  const msg = result ? GOOGLE_RESULT[result] : null
  return (
    <div className="space-y-3 rounded-lg border p-3">
      {msg && (
        <Alert variant={msg.ok ? 'default' : 'destructive'}>
          <AlertDescription>{msg.title}</AlertDescription>
        </Alert>
      )}
      <p className="text-sm font-medium">Google 연결</p>
      {loaded?.registered ? (
        <div className="space-y-1 text-sm">
          <p>
            <span className="font-medium">{GOOGLE_STATUS_LABEL[shown]}</span>
            {connectedAt && (
              <span className="text-muted-foreground">
                {' '}
                · 연결일 {new Date(connectedAt).toLocaleDateString('ko-KR')}
              </span>
            )}
          </p>
          {scopes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              승인된 권한:{' '}
              {scopes.map((x) => x.replace('https://www.googleapis.com/auth/', '')).join(', ')}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant={shown === 'connected' ? 'outline' : 'default'}
            disabled={connecting}
            onClick={onConnect}
          >
            {connecting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {hasToken ? '다시 연결' : 'Google로 연결'}
          </Button>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          클라이언트 ID·시크릿과 브랜드를 저장하면 「Google로 연결」 버튼이 나타납니다.
        </p>
      )}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          Google Cloud 콘솔의 OAuth 클라이언트(웹 애플리케이션)에 아래 주소를 「승인된 리디렉션
          URI」로 등록해 주세요.
        </p>
        <CopyCodeBlock code={buildAppUrl('/api/integrations/google/callback')} />
        <p className="text-xs text-muted-foreground">
          OAuth 동의 화면이 「테스트」 상태이면 승인이 7일 뒤 만료됩니다. 게시 상태를
          「프로덕션」으로 두는 것을 권장합니다.
        </p>
      </div>
    </div>
  )
}
