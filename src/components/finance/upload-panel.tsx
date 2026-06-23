'use client'

/**
 * 재무 관리 Deck — 데이터 등록 패널 (단일 화면 업로드).
 * 파일 선택 → preview API → 컬럼 매핑 에디터 → commit-staging API.
 */
import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Info, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { FINANCE_TRANSACTIONS_PATH } from '@/lib/deck-routes'
import { BANK_FIELDS, CARD_FIELDS } from '@/lib/finance/parser'

// ─── 타입 ────────────────────────────────────────────────────────────────────

type FinKind = 'BANK' | 'CARD'

type Preamble = {
  accountNumber?: string
  holder?: string
  periodFrom?: string
  periodTo?: string
}

type PreviewData = {
  headers: string[]
  sampleRows: string[][]
  totalRows: number
  emptyColumns: number[]
  sheetNames: string[]
  activeSheet: string
  preamble: Preamble
}

type MappingEntry = { headerName: string; field: string }

type MatchedPreset = {
  id: string
  name: string
  institution: string
  kind: string
  mapping: MappingEntry[]
  defaultAccountId: string | null
}

type Account = {
  id: string
  name: string
  kind: string
  institution: string | null
  accountNumber: string | null
}

type PreviewResponse = {
  fileName: string
  preview: PreviewData
  kind: FinKind
  institution: string | null
  suggestedMapping: MappingEntry[]
  matchedPreset: MatchedPreset | null
  accounts: Account[]
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const NONE_FIELD = '__none__'
const NONE_ACCOUNT = '__none__'

/** 기본 필수: txnDate, description; BANK는 deposit|withdrawal 중 하나; CARD는 amount */
function isMappingValid(
  mapping: Record<number, string>,
  kind: FinKind,
  headers: string[]
): { ok: boolean; reason?: string } {
  const mappedFields = new Set(Object.values(mapping))
  if (!mappedFields.has('txnDate')) return { ok: false, reason: '거래일시를 매핑해 주세요' }
  if (!mappedFields.has('description'))
    return { ok: false, reason: '적요/가맹점명을 매핑해 주세요' }
  if (kind === 'BANK' && !mappedFields.has('deposit') && !mappedFields.has('withdrawal')) {
    return { ok: false, reason: '은행은 입금 또는 출금 컬럼을 매핑해야 합니다' }
  }
  if (kind === 'CARD' && !mappedFields.has('amount')) {
    return { ok: false, reason: '카드는 매출금액을 매핑해야 합니다' }
  }
  // 중복 필드 검사 (same field assigned to multiple headers)
  const fieldCount = new Map<string, number>()
  for (const f of Object.values(mapping)) {
    fieldCount.set(f, (fieldCount.get(f) ?? 0) + 1)
  }
  for (const [f, cnt] of fieldCount) {
    if (cnt > 1) return { ok: false, reason: `"${f}" 필드가 여러 컬럼에 중복 할당되었습니다` }
  }
  // 미사용 headers 체크는 불필요 — 일부 컬럼은 (사용 안 함) 가능
  void headers
  return { ok: true }
}

/** suggestedMapping/preset.mapping [{headerName, field}] → Record<headerIdx, field> */
function mappingEntriesToState(entries: MappingEntry[], headers: string[]): Record<number, string> {
  const result: Record<number, string> = {}
  for (const { headerName, field } of entries) {
    const idx = headers.findIndex((h) => h === headerName)
    if (idx >= 0 && !(idx in result)) {
      result[idx] = field
    }
  }
  return result
}

/** state Record<headerIdx, field> → API [{headerName, field}] */
function stateToMappingEntries(mapping: Record<number, string>, headers: string[]): MappingEntry[] {
  return Object.entries(mapping)
    .filter(([, field]) => field !== NONE_FIELD && field !== '')
    .map(([idxStr, field]) => ({
      headerName: headers[Number(idxStr)] ?? '',
      field,
    }))
    .filter((e) => e.headerName !== '')
}

/** kind 변경 시 매핑에서 새 kind에 없는 필드 제거 */
function filterMappingForKind(
  mapping: Record<number, string>,
  newKind: FinKind
): Record<number, string> {
  const validFields = new Set<string>(
    (newKind === 'BANK' ? BANK_FIELDS : CARD_FIELDS).map((f) => f.value)
  )
  const result: Record<number, string> = {}
  for (const [idx, field] of Object.entries(mapping)) {
    if (validFields.has(field)) result[Number(idx)] = field
  }
  return result
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function FinanceUploadPanel() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  // 파일 + 미리보기 상태
  const [file, setFile] = useState<File | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewRes, setPreviewRes] = useState<PreviewResponse | null>(null)

  // 사용자 편집 상태 (preview 이후)
  const [kind, setKind] = useState<FinKind>('BANK')
  const [accountId, setAccountId] = useState<string>('')
  // 매핑: Record<headerIdx, fieldValue | '__none__'>
  const [mapping, setMapping] = useState<Record<number, string>>({})
  // 프리셋 저장 옵션
  const [savePreset, setSavePreset] = useState(false)
  const [presetName, setPresetName] = useState('')

  // 가져오기 실행 중
  const [importing, setImporting] = useState(false)

  // 드래그 오버 상태
  const [dragOver, setDragOver] = useState(false)

  // 파일 정보 영역 인라인 계좌 등록 폼 표시 여부
  const [showAccountForm, setShowAccountForm] = useState(false)

  // ─── preview 요청 ──────────────────────────────────────────────────────────

  const handleFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    setPreviewRes(null)
    setMapping({})
    setSavePreset(false)
    setPresetName('')
    setShowAccountForm(false)
    setPreviewing(true)

    try {
      const fd = new FormData()
      fd.append('file', selectedFile)
      const res = await fetch('/api/finance/imports/preview', { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '파일 미리보기 실패')
      }
      const data: PreviewResponse = await res.json()
      setPreviewRes(data)
      setKind(data.kind)

      // 매핑 초기값: matchedPreset > suggestedMapping
      const source = data.matchedPreset?.mapping ?? data.suggestedMapping
      const initialMapping = mappingEntriesToState(source, data.preview.headers)
      setMapping(initialMapping)

      // 계좌 초기 선택: matchedPreset.defaultAccountId > 첫 번째 계좌
      const defaultAccount =
        data.matchedPreset?.defaultAccountId ??
        (data.accounts.length === 1 ? data.accounts[0]?.id : null)
      setAccountId(defaultAccount ?? '')

      // 프리셋 이름 초기값
      setPresetName(data.institution ?? data.matchedPreset?.name ?? '')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일 처리 실패')
      setFile(null)
    } finally {
      setPreviewing(false)
    }
  }, [])

  // ─── kind 변경 ────────────────────────────────────────────────────────────

  function handleKindChange(newKind: FinKind) {
    setKind(newKind)
    setMapping((prev) => filterMappingForKind(prev, newKind))
  }

  // ─── 필드 select 변경 ─────────────────────────────────────────────────────

  function handleFieldChange(headerIdx: number, field: string) {
    setMapping((prev) => {
      const next = { ...prev }
      if (field === NONE_FIELD || field === '') {
        delete next[headerIdx]
      } else {
        next[headerIdx] = field
      }
      return next
    })
  }

  // ─── 계좌 등록 (파일 정보 영역 인라인) ──────────────────────────────────────

  /** 인라인 폼에서 계좌 생성 성공 시: 후보 목록에 추가하고 적재 계좌로 자동 선택 */
  function handleAccountCreated(account: Account) {
    setPreviewRes((prev) => (prev ? { ...prev, accounts: [...prev.accounts, account] } : prev))
    setAccountId(account.id)
    setShowAccountForm(false)
  }

  // ─── 가져오기 ─────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!file || !previewRes) {
      toast.error('파일을 선택해 주세요')
      return
    }
    if (!accountId || accountId === NONE_ACCOUNT) {
      toast.error('계좌를 선택해 주세요')
      return
    }

    const pairs = stateToMappingEntries(mapping, previewRes.preview.headers)
    const validation = isMappingValid(mapping, kind, previewRes.preview.headers)
    if (!validation.ok) {
      toast.error(validation.reason ?? '매핑을 확인해 주세요')
      return
    }

    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('accountId', accountId)
      fd.append('kind', kind)
      fd.append('mapping', JSON.stringify(pairs))
      fd.append('institution', previewRes.institution ?? '')
      fd.append('savePreset', savePreset ? 'true' : '')
      if (savePreset && presetName.trim()) {
        fd.append('presetName', presetName.trim())
      }

      const res = await fetch('/api/finance/imports/commit-staging', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '가져오기 실패')

      const { importId, counts } = data as {
        importId: string
        counts: {
          total: number
          new: number
          dupSame: number
          dupChanged: number
          classified: number
          review: number
          unclassified: number
          parseErrors: number
        }
      }

      const dupTotal = counts.dupSame + counts.dupChanged
      toast.success(
        `신규 ${counts.new}건 · 중복 ${dupTotal}건 · 검토 ${counts.review}건 (총 ${counts.total}건)`
      )
      router.push(`${FINANCE_TRANSACTIONS_PATH}?importId=${importId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '가져오기 실패')
    } finally {
      setImporting(false)
    }
  }

  // ─── 유효성 계산 ──────────────────────────────────────────────────────────

  const hasAccounts = (previewRes?.accounts.length ?? 0) > 0
  // 파일 preamble에서 추출된 계좌번호가 이미 등록된 계좌와 일치하는지 (숫자만 비교)
  const fileAccountNumber = previewRes?.preview.preamble.accountNumber?.trim() ?? ''
  const normalizedFileAcct = fileAccountNumber.replace(/\D/g, '')
  const fileAccountMatched =
    normalizedFileAcct.length >= 4 &&
    (previewRes?.accounts ?? []).some(
      (a) => (a.accountNumber ?? '').replace(/\D/g, '') === normalizedFileAcct
    )
  const validation = previewRes
    ? isMappingValid(mapping, kind, previewRes.preview.headers)
    : { ok: false }
  const canImport =
    !!file &&
    !!previewRes &&
    hasAccounts &&
    !!accountId &&
    accountId !== NONE_ACCOUNT &&
    validation.ok &&
    !importing

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* 파일 선택 영역 */}
      <Card>
        <CardContent className="pt-6">
          <div
            className={cn(
              'flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-8 py-10 text-center transition-colors',
              dragOver ? 'border-primary/60 bg-primary/5' : 'border-border',
              previewing && 'opacity-60'
            )}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f && !previewing) void handleFile(f)
            }}
          >
            <Upload className="mb-3 size-8 text-muted-foreground/50" />
            {file && previewRes ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  총 {previewRes.preview.totalRows}건 · {previewRes.preview.activeSheet}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {previewing ? '파일 분석 중...' : '파일을 드래그하거나 선택하세요'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Excel(.xlsx, .xls) 또는 CSV</p>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => fileRef.current?.click()}
              disabled={previewing}
            >
              {file ? '다른 파일 선택' : '파일 선택'}
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
              e.target.value = ''
            }}
          />
        </CardContent>
      </Card>

      {/* 미리보기 + 매핑 영역 */}
      {previewRes && (
        <>
          {/* 종류 / 기관 / 계좌 */}
          <Card>
            <CardHeader>
              <CardTitle>파일 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* preamble 보조 정보 */}
              {(previewRes.preview.preamble.accountNumber ||
                previewRes.preview.preamble.holder ||
                previewRes.preview.preamble.periodFrom) && (
                <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="size-3.5 shrink-0" />
                  {previewRes.preview.preamble.holder && (
                    <span>예금주: {previewRes.preview.preamble.holder}</span>
                  )}
                  {previewRes.preview.preamble.accountNumber && (
                    <span>계좌: {previewRes.preview.preamble.accountNumber}</span>
                  )}
                  {previewRes.preview.preamble.periodFrom && (
                    <span>
                      기간: {previewRes.preview.preamble.periodFrom}
                      {previewRes.preview.preamble.periodTo &&
                        ` ~ ${previewRes.preview.preamble.periodTo}`}
                    </span>
                  )}
                  {/* 파일 계좌 등록 상태 / 바로 등록 */}
                  {fileAccountNumber &&
                    (fileAccountMatched ? (
                      <span className="ml-auto inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="size-3.5 shrink-0" />
                        등록된 계좌
                      </span>
                    ) : (
                      !showAccountForm && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto h-7"
                          onClick={() => setShowAccountForm(true)}
                        >
                          <Plus className="mr-1 size-3.5" />이 계좌 등록
                        </Button>
                      )
                    ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* 종류 */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">거래 종류</Label>
                  <Select value={kind} onValueChange={(v) => handleKindChange(v as FinKind)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BANK">은행 거래내역</SelectItem>
                      <SelectItem value="CARD">카드 이용내역</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 기관 */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">금융 기관</Label>
                  <p className="flex h-8 items-center text-sm">
                    {previewRes.institution ?? (
                      <span className="text-muted-foreground">자동 인식 불가</span>
                    )}
                  </p>
                </div>

                {/* 계좌 선택 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs text-muted-foreground">
                      적재 계좌 <span className="text-destructive">*</span>
                    </Label>
                    {hasAccounts && !showAccountForm && (
                      <button
                        type="button"
                        onClick={() => setShowAccountForm(true)}
                        className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                      >
                        <Plus className="size-3" />새 계좌
                      </button>
                    )}
                  </div>
                  {!hasAccounts ? (
                    showAccountForm ? (
                      <p className="flex h-8 items-center gap-1 text-xs text-muted-foreground">
                        <Info className="size-3.5 shrink-0" />
                        아래에서 계좌 정보를 입력하세요
                      </p>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-start text-amber-700 dark:text-amber-400"
                        onClick={() => setShowAccountForm(true)}
                      >
                        <AlertTriangle className="mr-1 size-3.5 shrink-0" />
                        계좌를 먼저 등록하세요
                      </Button>
                    )
                  ) : (
                    <Select
                      value={accountId || NONE_ACCOUNT}
                      onValueChange={(v) => setAccountId(v === NONE_ACCOUNT ? '' : v)}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="계좌 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_ACCOUNT}>계좌 선택</SelectItem>
                        {previewRes.accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            <span>{a.name}</span>
                            {a.institution && (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                · {a.institution}
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* 매칭된 프리셋 배지 */}
              {previewRes.matchedPreset ? (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400"
                  >
                    기억된 규칙: {previewRes.matchedPreset.name}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    컬럼 매핑이 자동 적용되었습니다
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                    신규
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    저장된 규칙이 없습니다 — 매핑 후 저장할 수 있습니다
                  </span>
                </div>
              )}

              {/* 인라인 계좌 등록 폼 — 파일 정보를 prefill */}
              {showAccountForm && (
                <InlineAccountForm
                  prefill={{
                    name: previewRes.institution ?? previewRes.preview.preamble.holder ?? '',
                    kind,
                    institution: previewRes.institution ?? '',
                    accountNumber: previewRes.preview.preamble.accountNumber ?? '',
                  }}
                  onCancel={() => setShowAccountForm(false)}
                  onCreated={handleAccountCreated}
                />
              )}
            </CardContent>
          </Card>

          {/* 컬럼 매핑 에디터 */}
          <Card>
            <CardHeader>
              <CardTitle>컬럼 매핑</CardTitle>
            </CardHeader>
            <CardContent>
              <MappingEditor
                headers={previewRes.preview.headers}
                emptyColumns={previewRes.preview.emptyColumns}
                mapping={mapping}
                kind={kind}
                onFieldChange={handleFieldChange}
              />
            </CardContent>
          </Card>

          {/* 샘플 미리보기 */}
          <Card>
            <CardHeader>
              <CardTitle>
                샘플 미리보기
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  총 {previewRes.preview.totalRows}건 중 {previewRes.preview.sampleRows.length}행
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <SampleTable
                headers={previewRes.preview.headers}
                sampleRows={previewRes.preview.sampleRows}
                emptyColumns={previewRes.preview.emptyColumns}
                mapping={mapping}
              />
            </CardContent>
          </Card>

          {/* 이 규칙 기억 + 가져오기 */}
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-end sm:justify-between">
              {/* 규칙 저장 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Switch id="save-preset" checked={savePreset} onCheckedChange={setSavePreset} />
                  <Label htmlFor="save-preset" className="cursor-pointer text-sm">
                    이 규칙 기억
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    — 다음에 같은 파일 형식을 업로드할 때 자동 적용됩니다
                  </span>
                </div>
                {savePreset && (
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor="preset-name"
                      className="text-xs whitespace-nowrap text-muted-foreground"
                    >
                      규칙 이름
                    </Label>
                    <Input
                      id="preset-name"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="예: 국민은행 사업자"
                      className="h-8 max-w-64 text-sm"
                      maxLength={100}
                    />
                  </div>
                )}
              </div>

              {/* 검증 메시지 + 가져오기 버튼 */}
              <div className="flex items-center gap-3">
                {!validation.ok && previewRes && (
                  <span className="text-xs text-destructive">{validation.reason}</span>
                )}
                {!hasAccounts && (
                  <span className="text-xs text-destructive">
                    계좌 등록 후 가져오기가 가능합니다
                  </span>
                )}
                <Button onClick={handleImport} disabled={!canImport}>
                  {importing ? '가져오는 중...' : `${previewRes.preview.totalRows}건 가져오기`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ─── 인라인 계좌 등록 폼 ───────────────────────────────────────────────────────

type InlineAccountFormProps = {
  /** 업로드 파일 정보에서 추출한 초기값 */
  prefill: { name: string; kind: FinKind; institution: string; accountNumber: string }
  onCancel: () => void
  /** 등록 성공 시 생성된 계좌를 부모로 전달(후보 목록 추가 + 자동 선택) */
  onCreated: (account: Account) => void
}

function InlineAccountForm({ prefill, onCancel, onCreated }: InlineAccountFormProps) {
  const [name, setName] = useState(prefill.name)
  const [accKind, setAccKind] = useState<FinKind>(prefill.kind)
  const [institution, setInstitution] = useState(prefill.institution)
  const [accountNumber, setAccountNumber] = useState(prefill.accountNumber)
  const [accountType, setAccountType] = useState('')
  const [openingBalance, setOpeningBalance] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) {
      toast.error('계좌 이름을 입력해 주세요')
      return
    }
    if (!institution.trim()) {
      toast.error('금융기관명을 입력해 주세요')
      return
    }

    const payload = {
      name: name.trim(),
      kind: accKind,
      institution: institution.trim(),
      accountNumber: accountNumber.trim() || undefined,
      accountType: accountType.trim() || undefined,
      ...(openingBalance.trim() !== '' && { openingBalance: Number(openingBalance) }),
    }

    setSaving(true)
    try {
      const res = await fetch('/api/finance/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as {
        message?: string
        account?: {
          id: string
          name: string
          kind: string
          institution: string | null
          accountNumber: string | null
        }
      }
      if (!res.ok || !data.account) throw new Error(data?.message ?? '계좌 등록 실패')
      toast.success('계좌가 등록되어 적재 계좌로 선택되었습니다')
      onCreated({
        id: data.account.id,
        name: data.account.name,
        kind: data.account.kind,
        institution: data.account.institution,
        accountNumber: data.account.accountNumber,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '계좌 등록 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">새 계좌 등록</p>
        <span className="text-xs text-muted-foreground">
          파일 정보를 불러왔습니다 — 확인 후 등록하세요
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* 이름 */}
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">계좌 이름 *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 기업은행 사업용"
            className="h-8 text-sm"
          />
        </div>

        {/* 종류 */}
        <div className="space-y-1">
          <Label className="text-xs">종류 *</Label>
          <Select value={accKind} onValueChange={(v) => setAccKind(v as FinKind)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BANK">은행</SelectItem>
              <SelectItem value="CARD">카드</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 금융기관 */}
        <div className="space-y-1">
          <Label className="text-xs">금융기관 *</Label>
          <Input
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="예: 기업은행"
            className="h-8 text-sm"
          />
        </div>

        {/* 계좌번호 */}
        <div className="space-y-1">
          <Label className="text-xs">계좌번호</Label>
          <Input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="선택 입력"
            className="h-8 font-mono text-sm"
          />
        </div>

        {/* 계좌 유형 */}
        <div className="space-y-1">
          <Label className="text-xs">계좌 유형</Label>
          <Input
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
            placeholder="예: 보통예금"
            className="h-8 text-sm"
          />
        </div>

        {/* 기초 잔액 */}
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">기초 잔액 (원)</Label>
          <Input
            type="number"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            placeholder="선택 입력"
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          취소
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? '등록 중...' : '계좌 등록'}
        </Button>
      </div>
    </div>
  )
}

// ─── 컬럼 매핑 에디터 ────────────────────────────────────────────────────────

type MappingEditorProps = {
  headers: string[]
  emptyColumns: number[]
  mapping: Record<number, string>
  kind: FinKind
  onFieldChange: (headerIdx: number, field: string) => void
}

function MappingEditor({
  headers,
  emptyColumns,
  mapping,
  kind,
  onFieldChange,
}: MappingEditorProps) {
  const fieldDefs = kind === 'BANK' ? BANK_FIELDS : CARD_FIELDS
  const emptySet = new Set(emptyColumns)

  return (
    <div className="divide-y rounded-md border">
      {headers.map((header, idx) => {
        const isEmpty = emptySet.has(idx)
        const currentField = mapping[idx] ?? NONE_FIELD
        const isRequired = fieldDefs.find((f) => f.value === currentField)?.required ?? false

        return (
          <div
            key={idx}
            className={cn('flex items-center gap-3 px-3 py-2', isEmpty && 'opacity-40')}
          >
            {/* 헤더명 */}
            <div className="w-44 shrink-0">
              <span
                className={cn(
                  'block truncate text-sm',
                  isEmpty ? 'text-muted-foreground italic' : '',
                  isRequired && currentField !== NONE_FIELD ? 'font-medium' : ''
                )}
                title={header || `컬럼 ${idx + 1}`}
              >
                {header || <span className="text-muted-foreground">{`컬럼 ${idx + 1}`}</span>}
              </span>
              {isEmpty && <span className="text-xs text-muted-foreground">(빈 컬럼)</span>}
            </div>

            {/* 화살표 */}
            <span className="shrink-0 text-xs text-muted-foreground">→</span>

            {/* 필드 Select */}
            <Select
              value={currentField}
              onValueChange={(v) => onFieldChange(idx, v)}
              disabled={isEmpty}
            >
              <SelectTrigger className={cn('h-8 w-52 text-xs', isEmpty && 'opacity-50')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_FIELD}>
                  <span className="text-muted-foreground">(사용 안 함)</span>
                </SelectItem>
                {fieldDefs.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                    {f.required && <span className="ml-1 text-destructive">*</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* 현재 매핑된 라벨 배지 */}
            {currentField !== NONE_FIELD && (
              <Badge
                variant="secondary"
                className={cn(
                  'shrink-0 text-xs',
                  fieldDefs.find((f) => f.value === currentField)?.required
                    ? 'border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-400'
                    : ''
                )}
              >
                {fieldDefs.find((f) => f.value === currentField)?.label ?? currentField}
              </Badge>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── 샘플 미리보기 테이블 ─────────────────────────────────────────────────────

type SampleTableProps = {
  headers: string[]
  sampleRows: string[][]
  emptyColumns: number[]
  mapping: Record<number, string>
}

function SampleTable({ headers, sampleRows, emptyColumns, mapping }: SampleTableProps) {
  const emptySet = new Set(emptyColumns)
  const mappedSet = new Set(Object.keys(mapping).map(Number))

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          {headers.map((h, i) => {
            const isEmpty = emptySet.has(i)
            const isMapped = mappedSet.has(i)
            return (
              <TableHead
                key={i}
                className={cn(
                  'text-xs whitespace-nowrap',
                  isEmpty && 'italic opacity-40',
                  isMapped && !isEmpty && 'font-medium text-foreground'
                )}
              >
                {h || `컬럼 ${i + 1}`}
              </TableHead>
            )
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sampleRows.map((row, ri) => (
          <TableRow key={ri}>
            {row.map((cell, ci) => {
              const isEmpty = emptySet.has(ci)
              const isMapped = mappedSet.has(ci)
              return (
                <TableCell
                  key={ci}
                  title={cell}
                  className={cn(
                    'max-w-[200px] truncate text-xs',
                    isEmpty && 'text-muted-foreground italic opacity-40',
                    !isMapped && !isEmpty && 'text-muted-foreground opacity-60',
                    isMapped && !isEmpty && 'text-foreground'
                  )}
                >
                  {cell}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
