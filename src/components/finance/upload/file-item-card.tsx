'use client'

/**
 * 다중 업로드 — 파일 1개 행 카드.
 * 접힘: 상태 배지 + 매칭 결과(계좌·기간·건수). 펼침: 종류/계좌/매핑 편집.
 */
import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { FINANCE_TRANSACTIONS_PATH } from '@/lib/deck-routes'

import { MappingEditor, SampleTable } from './mapping-editor'
import { AccountRegisterDialog } from './account-register-dialog'
import {
  NONE_ACCOUNT,
  findMatchedAccount,
  isMappingValid,
  type Account,
  type FinKind,
  type UploadFileItem,
} from './types'

type FileItemCardProps = {
  item: UploadFileItem
  /** 전체 계좌 목록(패널 공유 — 새 계좌 등록 시 모든 파일에서 후보로 보임) */
  accounts: Account[]
  /** 같은 계좌·기간 겹침 경고 대상 여부 */
  overlapWarning: boolean
  /** 배치 등록 진행 중 — 편집·삭제 잠금 */
  batchLocked: boolean
  onChange: (id: string, patch: Partial<UploadFileItem>) => void
  onRemove: (id: string) => void
  onRetryAnalyze: (id: string) => void
  onAccountCreated: (itemId: string, account: Account) => void
}

export function FileItemCard({
  item,
  accounts,
  overlapWarning,
  batchLocked,
  onChange,
  onRemove,
  onRetryAnalyze,
  onAccountCreated,
}: FileItemCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showAccountForm, setShowAccountForm] = useState(false)

  const { preview } = item
  const isCard = item.kind === 'CARD'
  const kindAccounts = accounts.filter((a) => a.kind === item.kind)
  const selectedAccount = kindAccounts.find((a) => a.id === item.accountId)
  const matchedAccount = preview
    ? findMatchedAccount(accounts, preview.preview.preamble.accountNumber)
    : null
  const validation = preview ? isMappingValid(item.mapping, item.kind) : { ok: false as const }
  const preamble = preview?.preview.preamble

  const canEdit = !batchLocked && (item.status === 'matched' || item.status === 'needs_review')

  // ─── 매핑 편집 핸들러 (panel state로 위임) ─────────────────────────────────

  function setFieldColumn(field: string, colIdx: number | null) {
    const next = { ...item.mapping }
    if (colIdx === null) delete next[field]
    else next[field] = [colIdx]
    onChange(item.id, { mapping: next })
  }

  function addColumn(field: string, colIdx: number) {
    const existing = item.mapping[field] ?? []
    if (existing.includes(colIdx)) return
    onChange(item.id, { mapping: { ...item.mapping, [field]: [...existing, colIdx] } })
  }

  function removeColumn(field: string, colIdx: number) {
    const existing = item.mapping[field] ?? []
    const filtered = existing.filter((i) => i !== colIdx)
    const next = { ...item.mapping }
    if (filtered.length === 0) delete next[field]
    else next[field] = filtered
    onChange(item.id, { mapping: next })
  }

  function handleKindChange(newKind: FinKind) {
    // kind가 바뀌면 다른 종류 계좌 선택 무효 — panel에서 mapping 필터 + 상태 재판정
    const acct = accounts.find((a) => a.id === item.accountId)
    onChange(item.id, {
      kind: newKind,
      accountId: acct && acct.kind === newKind ? item.accountId : '',
    })
  }

  // ─── 상태 표시 ────────────────────────────────────────────────────────────

  function statusBadge() {
    switch (item.status) {
      case 'queued':
      case 'analyzing':
        return (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            분석 중
          </Badge>
        )
      case 'matched':
        return (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-3" />
            {matchedAccount && item.accountId === matchedAccount.id ? '자동 매칭' : '준비됨'}
          </Badge>
        )
      case 'needs_review':
        return (
          <Badge
            variant="outline"
            className="gap-1 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400"
          >
            <AlertTriangle className="size-3" />
            확인 필요
          </Badge>
        )
      case 'analyze_failed':
        return (
          <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
            <XCircle className="size-3" />
            분석 실패
          </Badge>
        )
      case 'committing':
        return (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            등록 중
          </Badge>
        )
      case 'done':
        return (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-3" />
            등록 완료
          </Badge>
        )
      case 'commit_failed':
        return (
          <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
            <XCircle className="size-3" />
            등록 실패
          </Badge>
        )
    }
  }

  /** needs_review 사유 한 줄 */
  function reviewReason(): string | null {
    if (item.status !== 'needs_review') return null
    if (!item.accountId || item.accountId === NONE_ACCOUNT) {
      if (kindAccounts.length === 0)
        return isCard
          ? '등록된 카드가 없습니다 — 카드를 등록하세요'
          : '등록된 계좌가 없습니다 — 계좌를 등록하세요'
      return isCard ? '연결 카드를 선택하세요' : '적재 계좌를 선택하세요'
    }
    if (!validation.ok) return validation.reason ?? '매핑을 확인하세요'
    return null
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-card',
        item.status === 'needs_review' && 'border-amber-300 dark:border-amber-800',
        (item.status === 'analyze_failed' || item.status === 'commit_failed') &&
          'border-destructive/40'
      )}
    >
      {/* 헤더 행 */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <FileSpreadsheet className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{item.file.name}</p>
            {statusBadge()}
            {overlapWarning && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400"
              >
                <AlertTriangle className="size-3" />
                기간 겹침
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {item.status === 'analyze_failed' || item.status === 'commit_failed' ? (
              <span className="text-destructive">{item.error ?? '처리 실패'}</span>
            ) : item.status === 'done' && item.result ? (
              <>
                신규 {item.result.counts.new}건 · 중복{' '}
                {item.result.counts.dupSame + item.result.counts.dupChanged}건 · 검토{' '}
                {item.result.counts.review}건 (총 {item.result.counts.total}건)
              </>
            ) : preview ? (
              <>
                {selectedAccount
                  ? [selectedAccount.institution, selectedAccount.name].filter(Boolean).join(' ')
                  : isCard
                    ? '카드 미선택'
                    : '계좌 미선택'}
                {' · '}총 {preview.preview.totalRows}건
                {preamble?.periodFrom && (
                  <>
                    {' · '}
                    {preamble.periodFrom}
                    {preamble.periodTo && ` ~ ${preamble.periodTo}`}
                  </>
                )}
              </>
            ) : (
              '파일 분석 대기'
            )}
          </p>
          {reviewReason() && (
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{reviewReason()}</p>
          )}
        </div>

        {/* 액션 */}
        <div className="flex shrink-0 items-center gap-1">
          {item.status === 'done' && item.result && (
            <Button asChild variant="outline" size="sm" className="h-7 text-xs">
              <Link href={`${FINANCE_TRANSACTIONS_PATH}?importId=${item.result.importId}`}>
                검토하기
                <ExternalLink className="ml-1 size-3" />
              </Link>
            </Button>
          )}
          {item.status === 'analyze_failed' && !batchLocked && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onRetryAnalyze(item.id)}
            >
              <RotateCcw className="mr-1 size-3" />
              다시 분석
            </Button>
          )}
          {canEdit && preview && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <>
                  접기 <ChevronUp className="ml-0.5 size-3.5" />
                </>
              ) : (
                <>
                  설정 <ChevronDown className="ml-0.5 size-3.5" />
                </>
              )}
            </Button>
          )}
          {!batchLocked && item.status !== 'done' && item.status !== 'committing' && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={() => onRemove(item.id)}
              aria-label="파일 제거"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* 펼침 영역 — 종류/계좌/매핑/샘플/프리셋 */}
      {expanded && canEdit && preview && (
        <div className="space-y-4 border-t px-3 py-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* 종류 */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">거래 종류</Label>
              <Select value={item.kind} onValueChange={(v) => handleKindChange(v as FinKind)}>
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
                {selectedAccount?.institution ??
                  preview.institution ??
                  matchedAccount?.institution ?? (
                    <span className="text-muted-foreground">
                      {isCard ? '카드 등록 시 자동 인식' : '계좌 등록 시 자동 인식'}
                    </span>
                  )}
              </p>
            </div>

            {/* 계좌 선택 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">
                  {isCard ? '연결 카드' : '적재 계좌'} <span className="text-destructive">*</span>
                </Label>
                {matchedAccount && item.accountId === matchedAccount.id && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" />
                    자동 선택됨
                  </span>
                )}
              </div>
              {kindAccounts.length === 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full justify-start text-amber-700 dark:text-amber-400"
                  onClick={() => setShowAccountForm(true)}
                >
                  <AlertTriangle className="mr-1 size-3.5 shrink-0" />
                  {isCard ? '카드를 먼저 등록하세요' : '계좌를 먼저 등록하세요'}
                </Button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Select
                    value={item.accountId || NONE_ACCOUNT}
                    onValueChange={(v) =>
                      onChange(item.id, { accountId: v === NONE_ACCOUNT ? '' : v })
                    }
                  >
                    <SelectTrigger
                      className={cn(
                        'h-8 flex-1 text-sm',
                        matchedAccount &&
                          item.accountId === matchedAccount.id &&
                          'border-emerald-400 ring-1 ring-emerald-400/40'
                      )}
                    >
                      <SelectValue placeholder={isCard ? '카드 선택' : '계좌 선택'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_ACCOUNT}>
                        {isCard ? '카드 선택' : '계좌 선택'}
                      </SelectItem>
                      {kindAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id} className="text-sm">
                          <span className="flex items-center gap-1.5">
                            {[a.institution, a.name].filter(Boolean).join(' ')}
                            {a.accountNumber && (
                              <span className="text-xs text-muted-foreground">
                                · {a.accountNumber}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    onClick={() => setShowAccountForm(true)}
                  >
                    {isCard ? '새 카드' : '새 계좌'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* 매칭된 프리셋 배지 */}
          {preview.matchedPreset && (
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400"
              >
                기억된 규칙: {preview.matchedPreset.name}
              </Badge>
              <span className="text-xs text-muted-foreground">컬럼 매핑이 자동 적용되었습니다</span>
            </div>
          )}

          {/* 컬럼 매핑 */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">컬럼 매핑</Label>
            <MappingEditor
              headers={preview.preview.headers}
              emptyColumns={preview.preview.emptyColumns}
              sampleRows={preview.preview.sampleRows}
              mapping={item.mapping}
              kind={item.kind}
              onSetColumn={setFieldColumn}
              onAddColumn={addColumn}
              onRemoveColumn={removeColumn}
            />
          </div>

          {/* 샘플 미리보기 */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              샘플 미리보기 — 총 {preview.preview.totalRows}건 중{' '}
              {preview.preview.sampleRows.length}행
            </Label>
            <div className="overflow-x-auto rounded-md border">
              <SampleTable
                headers={preview.preview.headers}
                sampleRows={preview.preview.sampleRows}
                emptyColumns={preview.preview.emptyColumns}
                mapping={item.mapping}
              />
            </div>
          </div>

          {/* 거래후잔액 미매핑 경고 */}
          {item.kind === 'BANK' && (item.mapping['balanceAfter']?.length ?? 0) === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              거래후잔액 미매핑 시 같은 날 같은 금액 거래가 중복으로 건너뛰어질 수 있습니다
            </p>
          )}

          {/* 이 규칙 기억 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Switch
                id={`save-preset-${item.id}`}
                checked={item.savePreset}
                onCheckedChange={(v) => onChange(item.id, { savePreset: v })}
              />
              <Label htmlFor={`save-preset-${item.id}`} className="cursor-pointer text-sm">
                이 규칙 기억
              </Label>
              <span className="text-xs text-muted-foreground">
                — 다음에 같은 파일 형식을 업로드할 때 자동 적용됩니다
              </span>
            </div>
            {item.savePreset && (
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap text-muted-foreground">규칙 이름</Label>
                <Input
                  value={item.presetName}
                  onChange={(e) => onChange(item.id, { presetName: e.target.value })}
                  placeholder="예: 국민은행 사업자"
                  className="h-8 max-w-64 text-sm"
                  maxLength={100}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 새 계좌 등록 다이얼로그 */}
      {showAccountForm && preview && (
        <AccountRegisterDialog
          prefill={{
            name: preview.institution ?? preamble?.holder ?? '',
            holder: preamble?.holder ?? '',
            kind: item.kind,
            institution: preview.institution ?? '',
            accountNumber: preamble?.accountNumber ?? '',
          }}
          onCancel={() => setShowAccountForm(false)}
          onCreated={(account) => {
            setShowAccountForm(false)
            onAccountCreated(item.id, account)
          }}
        />
      )}
    </div>
  )
}
