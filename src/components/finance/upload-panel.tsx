'use client'

/**
 * 재무 관리 Deck — 데이터 등록 패널 (단일 화면 업로드).
 * 파일 선택 → preview API → 컬럼 매핑 에디터 → commit-staging API.
 */
import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Plus, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatWon } from '@/components/finance/format'
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

/** 매핑 상태: 시스템 필드 → 파일 헤더 인덱스 배열(순서 = 결합 순서). */
type FieldMapping = Record<string, number[]>

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
  holder: string | null
  accountNumber: string | null
  openingBalance?: number | null
  currentBalance?: number | null
  currentBalanceAsOf?: string | null
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

/** 컬럼 select '(선택 안 함)' 센티넬 */
const NONE_COLUMN = '__none__'
const NONE_ACCOUNT = '__none__'

/** 다중 컬럼 결합 허용 필드 — 텍스트 필드만(숫자/날짜는 단일 컬럼). */
const MULTI_COLUMN_FIELDS = new Set<string>(['description'])

/** 계좌번호 정규화(숫자만) — 파일 preamble 계좌번호와 등록 계좌 매칭용. */
function normalizeAcct(n: string | null | undefined): string {
  return (n ?? '').replace(/\D/g, '')
}

/** 파일 preamble 계좌번호와 일치하는 등록 계좌(숫자 4자리+ 일치). 없으면 null. */
function findMatchedAccount(accounts: Account[], fileAcctNumber: string | null | undefined): Account | null {
  const norm = normalizeAcct(fileAcctNumber)
  if (norm.length < 4) return null
  return accounts.find((a) => normalizeAcct(a.accountNumber) === norm) ?? null
}

/** 필드 value → 라벨(검증 메시지용). */
function fieldLabel(field: string, kind: FinKind): string {
  const defs = kind === 'BANK' ? BANK_FIELDS : CARD_FIELDS
  return defs.find((f) => f.value === field)?.label ?? field
}

/** 기본 필수: txnDate, description; BANK는 deposit|withdrawal 중 하나; CARD는 amount */
function isMappingValid(mapping: FieldMapping, kind: FinKind): { ok: boolean; reason?: string } {
  const has = (f: string) => (mapping[f]?.length ?? 0) > 0
  if (!has('txnDate')) return { ok: false, reason: '거래일시를 매핑해 주세요' }
  if (!has('description'))
    return {
      ok: false,
      reason: kind === 'CARD' ? '가맹점명을 매핑해 주세요' : '적요/내용을 매핑해 주세요',
    }
  if (kind === 'BANK' && !has('deposit') && !has('withdrawal')) {
    return { ok: false, reason: '은행은 입금 또는 출금 컬럼을 매핑해야 합니다' }
  }
  if (kind === 'CARD' && !has('amount')) {
    return { ok: false, reason: '카드는 매출금액을 매핑해야 합니다' }
  }
  // 단일 필드에 컬럼 2개 이상 방어(UI에서 막지만 이중 가드)
  for (const f of Object.keys(mapping)) {
    if (!MULTI_COLUMN_FIELDS.has(f) && (mapping[f]?.length ?? 0) > 1) {
      return { ok: false, reason: `"${fieldLabel(f, kind)}"에는 컬럼을 하나만 지정할 수 있습니다` }
    }
  }
  return { ok: true }
}

/** suggestedMapping/preset.mapping [{headerName, field}] → FieldMapping(필드→헤더 인덱스 배열) */
function mappingEntriesToState(entries: MappingEntry[], headers: string[]): FieldMapping {
  const result: FieldMapping = {}
  for (const { headerName, field } of entries) {
    const idx = headers.findIndex((h) => h === headerName)
    if (idx < 0) continue
    const arr = (result[field] ??= [])
    if (!arr.includes(idx)) arr.push(idx)
  }
  return result
}

/** state FieldMapping → API [{headerName, field}] (필드별 컬럼 순서 보존) */
function stateToMappingEntries(mapping: FieldMapping, headers: string[]): MappingEntry[] {
  const entries: MappingEntry[] = []
  for (const [field, cols] of Object.entries(mapping)) {
    for (const idx of cols) {
      const headerName = headers[idx]
      if (headerName) entries.push({ headerName, field })
    }
  }
  return entries
}

/** kind 변경 시 매핑에서 새 kind에 없는 필드 제거 */
function filterMappingForKind(mapping: FieldMapping, newKind: FinKind): FieldMapping {
  const validFields = new Set<string>(
    (newKind === 'BANK' ? BANK_FIELDS : CARD_FIELDS).map((f) => f.value)
  )
  const result: FieldMapping = {}
  for (const [field, cols] of Object.entries(mapping)) {
    if (validFields.has(field)) result[field] = cols
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
  // 매핑: 시스템 필드 → 파일 헤더 인덱스 배열
  const [mapping, setMapping] = useState<FieldMapping>({})
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

      // 파일 계좌번호와 일치하는 등록 계좌 — 적재 계좌·거래 종류 자동 인식에 사용
      const matched = findMatchedAccount(data.accounts, data.preview.preamble.accountNumber)

      // 거래 종류: 매칭 계좌가 있으면 그 계좌의 종류, 없으면 파일 자동 판별
      const resolvedKind: FinKind =
        matched && (matched.kind === 'BANK' || matched.kind === 'CARD')
          ? (matched.kind as FinKind)
          : data.kind
      setKind(resolvedKind)

      // 매핑 초기값: matchedPreset > suggestedMapping. 최종 kind에 맞는 필드만 유지
      // (매칭 계좌 kind가 파일 자동판별과 다른 드문 경우 CARD/BANK 필드 혼입 방지).
      const source = data.matchedPreset?.mapping ?? data.suggestedMapping
      const initialMapping = filterMappingForKind(
        mappingEntriesToState(source, data.preview.headers),
        resolvedKind
      )
      setMapping(initialMapping)

      // 계좌 초기 선택: matchedPreset.defaultAccountId > 파일 계좌번호 매칭 > 계좌 1개
      const defaultAccount =
        data.matchedPreset?.defaultAccountId ??
        matched?.id ??
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

  // ─── 컬럼 매핑 변경 (시스템 필드 → 파일 컬럼) ──────────────────────────────

  /** 단일 컬럼 필드 — 선택/해제 */
  function setFieldColumn(field: string, colIdx: number | null) {
    setMapping((prev) => {
      const next = { ...prev }
      if (colIdx === null) delete next[field]
      else next[field] = [colIdx]
      return next
    })
  }

  /** 다중 컬럼 필드(적요/내용) — 컬럼 추가 */
  function addColumn(field: string, colIdx: number) {
    setMapping((prev) => {
      const existing = prev[field] ?? []
      if (existing.includes(colIdx)) return prev
      return { ...prev, [field]: [...existing, colIdx] }
    })
  }

  /** 다중 컬럼 필드(적요/내용) — 컬럼 제거 */
  function removeColumn(field: string, colIdx: number) {
    setMapping((prev) => {
      const existing = prev[field] ?? []
      const filtered = existing.filter((i) => i !== colIdx)
      const next = { ...prev }
      if (filtered.length === 0) delete next[field]
      else next[field] = filtered
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
    const validation = isMappingValid(mapping, kind)
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
  const fileAccountNumber = previewRes?.preview.preamble.accountNumber?.trim() ?? ''
  // 파일 preamble 계좌번호와 일치하는 등록 계좌(강조·자동선택용, 숫자만 비교)
  const matchedAccount = previewRes
    ? findMatchedAccount(previewRes.accounts, fileAccountNumber)
    : null
  const fileAccountMatched = !!matchedAccount
  // 금융 기관 표시: 파일 자동 인식 > 매칭 계좌 기관 > 미인식(계좌 등록 안내)
  const displayInstitution = previewRes?.institution ?? matchedAccount?.institution ?? null
  const validation = previewRes ? isMappingValid(mapping, kind) : { ok: false }
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
        <CardContent className={cn(file ? 'py-3' : 'pt-6')}>
          {!file ? (
            // 빈 상태: 큰 드롭존 (드래그&드롭)
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
              <p className="text-sm text-muted-foreground">
                {previewing ? '파일 분석 중...' : '파일을 드래그하거나 선택하세요'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Excel(.xlsx, .xls) 또는 CSV</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => fileRef.current?.click()}
                disabled={previewing}
              >
                파일 선택
              </Button>
            </div>
          ) : (
            // 파일 선택됨: 컴팩트 상태 바
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {previewing
                    ? '분석 중...'
                    : previewRes
                      ? `총 ${previewRes.preview.totalRows}건 · ${previewRes.preview.activeSheet}`
                      : '분석에 실패했습니다 — 다시 시도해 주세요'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => fileRef.current?.click()}
                disabled={previewing}
              >
                다른 파일 선택
              </Button>
            </div>
          )}
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
              <div className="flex items-center justify-between gap-2">
                <CardTitle>파일 정보</CardTitle>
                {hasAccounts && !showAccountForm && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0"
                    onClick={() => setShowAccountForm(true)}
                  >
                    <Plus className="mr-1 size-3.5" />새 계좌
                  </Button>
                )}
              </div>
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
                  {/* 파일 계좌 등록 상태 강조 / 미등록 안내 */}
                  {fileAccountNumber &&
                    (fileAccountMatched && matchedAccount ? (
                      <span className="ml-auto inline-flex flex-wrap items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
                        <CheckCircle2 className="size-3.5 shrink-0" />
                        등록된 계좌 · {matchedAccount.name}
                        {matchedAccount.institution && (
                          <span className="opacity-80">· {matchedAccount.institution}</span>
                        )}
                        {matchedAccount.currentBalance != null && (
                          <span className="opacity-80">
                            · 잔액 {formatWon(matchedAccount.currentBalance)}
                            {matchedAccount.currentBalanceAsOf &&
                              ` (${matchedAccount.currentBalanceAsOf.slice(0, 10)} 기준)`}
                          </span>
                        )}
                      </span>
                    ) : (
                      // 계좌가 있는데 파일 계좌가 미등록일 때만 안내(우측 상단 '새 계좌' 버튼이 보이는 경우).
                      // 계좌가 하나도 없을 땐 아래 적재 계좌 영역의 '계좌를 먼저 등록하세요'가 유도한다.
                      hasAccounts &&
                      !showAccountForm && (
                        <span className="ml-auto inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          미등록 계좌 — 우측 상단 &lsquo;새 계좌&rsquo;로 등록
                        </span>
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
                    {displayInstitution ?? (
                      <span className="text-muted-foreground">계좌 등록 시 자동 인식</span>
                    )}
                  </p>
                </div>

                {/* 계좌 선택 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs text-muted-foreground">
                      적재 계좌 <span className="text-destructive">*</span>
                    </Label>
                    {matchedAccount && accountId === matchedAccount.id && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" />
                        자동 선택됨
                      </span>
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
                      <SelectTrigger
                        className={cn(
                          'h-8 text-sm',
                          matchedAccount &&
                            accountId === matchedAccount.id &&
                            'border-emerald-400 ring-1 ring-emerald-400/40'
                        )}
                      >
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

              {/* 계좌 등록 다이얼로그 — 파일 정보를 prefill */}
              {showAccountForm && (
                <AccountRegisterDialog
                  prefill={{
                    name: previewRes.institution ?? previewRes.preview.preamble.holder ?? '',
                    holder: previewRes.preview.preamble.holder ?? '',
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
                sampleRows={previewRes.preview.sampleRows}
                mapping={mapping}
                kind={kind}
                onSetColumn={setFieldColumn}
                onAddColumn={addColumn}
                onRemoveColumn={removeColumn}
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

// ─── 계좌 등록 다이얼로그 ───────────────────────────────────────────────────────

type AccountRegisterDialogProps = {
  /** 업로드 파일 정보에서 추출한 초기값 */
  prefill: {
    name: string
    holder: string
    kind: FinKind
    institution: string
    accountNumber: string
  }
  onCancel: () => void
  /** 등록 성공 시 생성된 계좌를 부모로 전달(후보 목록 추가 + 자동 선택) */
  onCreated: (account: Account) => void
}

function AccountRegisterDialog({ prefill, onCancel, onCreated }: AccountRegisterDialogProps) {
  const [name, setName] = useState(prefill.name)
  const [holder, setHolder] = useState(prefill.holder)
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
      holder: holder.trim() || undefined,
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
          holder: string | null
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
        holder: data.account.holder,
        accountNumber: data.account.accountNumber,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '계좌 등록 실패')
    } finally {
      setSaving(false)
    }
  }

  function handleEnter(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSave()
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>새 계좌 등록</DialogTitle>
          <DialogDescription>파일 정보를 확인한 뒤 적재 계좌로 등록하세요.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {/* 이름 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">계좌 이름 *</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleEnter}
              placeholder="예: 기업은행 사업용"
              className="h-8 text-sm"
            />
          </div>

          {/* 예금주 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">예금주</Label>
            <Input
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              onKeyDown={handleEnter}
              placeholder="예: 주식회사 워크덱"
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
              onKeyDown={handleEnter}
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
              onKeyDown={handleEnter}
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
              onKeyDown={handleEnter}
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
              onKeyDown={handleEnter}
              placeholder="선택 입력"
              className="h-8 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '등록 중...' : '계좌 등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 컬럼 매핑 에디터 ────────────────────────────────────────────────────────

type MappingEditorProps = {
  headers: string[]
  emptyColumns: number[]
  sampleRows: string[][]
  mapping: FieldMapping
  kind: FinKind
  onSetColumn: (field: string, colIdx: number | null) => void
  onAddColumn: (field: string, colIdx: number) => void
  onRemoveColumn: (field: string, colIdx: number) => void
}

/**
 * 좌측 = 시스템 필드(필수/선택·사용 여부), 우측 = 업로드 파일 컬럼 선택.
 * 텍스트 필드(적요/내용)는 다중 컬럼 선택 → 결합( " / " ).
 */
function MappingEditor({
  headers,
  emptyColumns,
  sampleRows,
  mapping,
  kind,
  onSetColumn,
  onAddColumn,
  onRemoveColumn,
}: MappingEditorProps) {
  const fieldDefs = kind === 'BANK' ? BANK_FIELDS : CARD_FIELDS
  const emptySet = new Set(emptyColumns)

  return (
    <div className="divide-y rounded-md border">
      {fieldDefs.map((f) => {
        const cols = mapping[f.value] ?? []
        const isMapped = cols.length > 0
        const isMulti = MULTI_COLUMN_FIELDS.has(f.value)

        return (
          <div key={f.value} className="flex items-start gap-3 px-3 py-2.5">
            {/* 시스템 필드 (좌) */}
            <div className="flex w-44 shrink-0 items-center gap-1.5 pt-1.5">
              <span className={cn('text-sm', isMapped ? 'font-medium' : 'text-muted-foreground')}>
                {f.label}
              </span>
              {f.required && <span className="text-destructive">*</span>}
              {f.required && !isMapped && (
                <Badge
                  variant="outline"
                  className="ml-auto h-5 border-destructive/40 px-1.5 text-[10px] text-destructive"
                >
                  필수
                </Badge>
              )}
              {isMapped && <CheckCircle2 className="ml-auto size-4 shrink-0 text-emerald-500" />}
            </div>

            {/* 화살표 (시스템 ← 파일) */}
            <span className="shrink-0 pt-2 text-xs text-muted-foreground">←</span>

            {/* 파일 컬럼 선택 (우) */}
            {isMulti ? (
              <MultiColumnPicker
                headers={headers}
                emptyColumns={emptyColumns}
                sampleRows={sampleRows}
                selected={cols}
                onAdd={(idx) => onAddColumn(f.value, idx)}
                onRemove={(idx) => onRemoveColumn(f.value, idx)}
              />
            ) : (
              <Select
                value={cols.length > 0 ? String(cols[0]) : NONE_COLUMN}
                onValueChange={(v) => onSetColumn(f.value, v === NONE_COLUMN ? null : Number(v))}
              >
                <SelectTrigger className="h-8 w-64 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_COLUMN}>
                    <span className="text-muted-foreground">(선택 안 함)</span>
                  </SelectItem>
                  {headers.map((h, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {h || `컬럼 ${i + 1}`}
                      {emptySet.has(i) && (
                        <span className="ml-1 text-muted-foreground">(빈 컬럼)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── 다중 컬럼 선택기 (적요/내용 등 텍스트 결합) ───────────────────────────────

type MultiColumnPickerProps = {
  headers: string[]
  emptyColumns: number[]
  sampleRows: string[][]
  selected: number[]
  onAdd: (colIdx: number) => void
  onRemove: (colIdx: number) => void
}

function MultiColumnPicker({
  headers,
  emptyColumns,
  sampleRows,
  selected,
  onAdd,
  onRemove,
}: MultiColumnPickerProps) {
  const emptySet = new Set(emptyColumns)
  const available = headers.map((h, i) => ({ h, i })).filter(({ i }) => !selected.includes(i))
  const preview = selected
    .map((i) => (sampleRows[0]?.[i] ?? '').trim())
    .filter((v) => v !== '')
    .join(' / ')

  return (
    <div className="flex-1 space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((i) => (
            <Badge key={i} variant="secondary" className="gap-1 pr-1 text-xs">
              <span className="max-w-32 truncate">{headers[i] || `컬럼 ${i + 1}`}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="rounded-sm hover:bg-muted-foreground/20"
                aria-label="컬럼 제거"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <span className="flex h-8 items-center text-xs text-muted-foreground">
          선택된 컬럼 없음
        </span>
      )}

      {available.length > 0 && (
        <Select value="" onValueChange={(v) => onAdd(Number(v))}>
          <SelectTrigger className="h-8 w-64 text-xs">
            <SelectValue placeholder="+ 컬럼 추가" />
          </SelectTrigger>
          <SelectContent>
            {available.map(({ h, i }) => (
              <SelectItem key={i} value={String(i)}>
                {h || `컬럼 ${i + 1}`}
                {emptySet.has(i) && <span className="ml-1 text-muted-foreground">(빈 컬럼)</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {selected.length > 1 && preview && (
        <p className="text-xs text-muted-foreground">
          미리보기: <span className="font-mono text-foreground">{preview}</span>
        </p>
      )}
    </div>
  )
}

// ─── 샘플 미리보기 테이블 ─────────────────────────────────────────────────────

type SampleTableProps = {
  headers: string[]
  sampleRows: string[][]
  emptyColumns: number[]
  mapping: FieldMapping
}

function SampleTable({ headers, sampleRows, emptyColumns, mapping }: SampleTableProps) {
  const emptySet = new Set(emptyColumns)
  const mappedSet = new Set(Object.values(mapping).flat())

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
