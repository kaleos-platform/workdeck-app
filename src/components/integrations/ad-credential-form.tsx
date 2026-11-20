'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'
import { APPROVALS_PATH } from '@/lib/deck-routes'

type Provider = 'meta-ads' | 'google-marketing' | 'naver-searchad'
type Field = { key: string; label: string; optional?: boolean }
type Def = {
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
}

const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v : '')

const DEFS: Record<Provider, Def> = {
  'meta-ads': {
    secrets: [
      { key: 'accessToken', label: '액세스 토큰' },
      { key: 'appSecret', label: '앱 시크릿' },
    ],
    columns: [{ key: 'adAccount', label: '광고 계정 ID' }],
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
      { key: 'clientId', label: '클라이언트 ID' },
      { key: 'clientSecret', label: '클라이언트 시크릿' },
      { key: 'refreshToken', label: '리프레시 토큰' },
    ],
    columns: [
      { key: 'ga4_property_id', label: 'GA4 속성 ID' },
      { key: 'gtm_account_id', label: '태그 관리자 계정 ID (선택)', optional: true },
      { key: 'gtm_container_id', label: '태그 관리자 컨테이너 ID (선택)', optional: true },
    ],
    digits: /^\d+$/,
    digitsMessage: '숫자만 입력해 주세요',
    max: 20,
    build: (secrets, _s, rows, defaultBrand) => ({
      secret: {
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
        refreshToken: secrets.refreshToken,
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
      { key: 'apiKey', label: '액세스 라이선스' },
      { key: 'secretKey', label: '비밀 키' },
    ],
    shared: { key: 'managerCustomerId', label: '관리 고객 ID' },
    columns: [{ key: 'customerId', label: '광고주 고객 ID' }],
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
}: {
  provider: Provider
  spaceId: string
  onChanged?: () => void
}) {
  const def = DEFS[provider]
  const url = `/api/spaces/${spaceId}/credentials/${provider}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [shared, setShared] = useState('')
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(def)])
  const [defaultId, setDefaultId] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
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
        } else if (!def.digits.test(v)) out.push(`${i + 1}번째 ${c.label}: ${def.digitsMessage}`)
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
            <Input
              id={`${provider}-${f.key}`}
              type="password"
              autoComplete="off"
              value={secrets[f.key] ?? ''}
              onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
            />
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
              value={shared}
              onChange={(e) => setShared(e.target.value)}
            />
          </div>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">브랜드별 계정</legend>
        <p className="text-xs text-muted-foreground">
          브랜드 이름은 에이전트가 어느 계정을 쓸지 고를 때 사용하는 이름입니다.
        </p>
        {rows.map((r, i) => (
          <div key={r.id} className="space-y-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${provider}-brand-${r.id}`}>브랜드 이름 {i + 1}</Label>
                <Input
                  id={`${provider}-brand-${r.id}`}
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
                    value={r.cols[c.key] ?? ''}
                    onChange={(e) =>
                      setRow(r.id, (x) => ({ ...x, cols: { ...x.cols, [c.key]: e.target.value } }))
                    }
                  />
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
        <p className="text-xs text-muted-foreground">
          저장할 때 연결을 확인하지 않습니다. 에이전트가 처음 조회할 때 확인됩니다.
        </p>
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
