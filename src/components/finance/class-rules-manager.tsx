'use client'

/**
 * 재무 — 자동 분류 규칙 관리. 좌측 계좌 목록(전체/전체 공통/계좌별 규칙 수) + 우측 규칙 표.
 * 검색(키워드·계정과목·메모)·필터(일치 방식·방향·미사용)는 클라이언트(규칙 수백 개 수준).
 * 행 클릭 → 수정 팝업(RuleDialog), 「규칙 추가」 → 같은 팝업 생성 모드(좌측 선택 계좌가 기본값).
 * 매칭 수는 텍스트 매칭 기준(rule-usage.ts) — 부분포함 규칙도 실제 걸리는 거래 수로 보인다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CategoryCombobox } from '@/components/finance/category-combobox'
import { accountKindLabel } from '@/components/finance/format'
import { categoryLabelOf, type ComboOption } from '@/lib/finance/category-options'
import { ymdOf } from '@/lib/finance/aggregate'
import { MEMO_MAX } from '@/lib/finance/memo'
import { cn } from '@/lib/utils'
import type { FinAccountKind } from '@/generated/prisma/enums'

type MatchType = 'EXACT' | 'KEYWORD'

type Rule = {
  id: string
  matchKey: string
  matchType: MatchType
  direction: 'IN' | 'OUT' | null
  memo: string | null
  accountId: string | null
  categoryId: string
  category: { id: string; name: string; parent: { name: string } | null } | null
  account: { id: string; name: string; kind: FinAccountKind } | null
  usage: { count: number; lastMatchedAt: string | null }
}

type Account = { id: string; name: string; kind: FinAccountKind }

/** 좌측 선택 — 전체 / 전체 공통 / 계좌 id */
type Scope = 'ALL' | 'COMMON' | string

const COMMON_VALUE = '__common__'

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function ClassRulesManager({
  leafTargets,
  onCountChange,
}: {
  leafTargets: ComboOption[]
  onCountChange?: (n: number) => void
}) {
  const [rules, setRules] = useState<Rule[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>('ALL')
  const [q, setQ] = useState('')
  const [matchFilter, setMatchFilter] = useState<'ALL' | MatchType>('ALL')
  const [dirFilter, setDirFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL')
  const [unusedOnly, setUnusedOnly] = useState(false)
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)

  const load = useCallback(async () => {
    try {
      const [ruleRes, accRes] = await Promise.all([
        fetch('/api/finance/rules'),
        fetch('/api/finance/accounts'),
      ])
      if (!ruleRes.ok || !accRes.ok) throw new Error('규칙 조회 실패')
      const ruleData = await ruleRes.json()
      const accData = await accRes.json()
      setRules(ruleData.rules ?? [])
      setAccounts(accData.accounts ?? [])
      onCountChange?.((ruleData.rules ?? []).length)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '규칙 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => {
    void load()
  }, [load])

  const countByScope = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rules) {
      const k = r.accountId ?? 'COMMON'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [rules])

  const needle = normalize(q)
  const visible = useMemo(
    () =>
      rules.filter(
        (r) =>
          (scope === 'ALL' ||
            (scope === 'COMMON' ? r.accountId === null : r.accountId === scope)) &&
          (matchFilter === 'ALL' || r.matchType === matchFilter) &&
          (dirFilter === 'ALL' || r.direction === dirFilter) &&
          (!unusedOnly || r.usage.count === 0) &&
          (!needle ||
            [r.matchKey, categoryLabelOf(r.category), r.memo ?? ''].some((s) =>
              s.toLowerCase().includes(needle)
            ))
      ),
    [rules, scope, matchFilter, dirFilter, unusedOnly, needle]
  )

  async function handleDelete(rule: Rule) {
    if (!confirm(`규칙 "${rule.matchKey}"을(를) 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/finance/rules/${rule.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '규칙 삭제 실패')
      toast.success(
        data?.reclassifiedStaged
          ? `규칙을 삭제했습니다 — 확인·처리 대기 ${data.reclassifiedStaged}건을 다시 분류했습니다`
          : '규칙을 삭제했습니다'
      )
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '규칙 삭제 실패')
    }
  }

  const scopeItems: { value: Scope; label: string; count: number }[] = [
    { value: 'ALL', label: '전체', count: rules.length },
    { value: 'COMMON', label: '전체 공통', count: countByScope.get('COMMON') ?? 0 },
    ...accounts.map((a) => ({
      value: a.id,
      label: `${accountKindLabel(a.kind)} · ${a.name}`,
      count: countByScope.get(a.id) ?? 0,
    })),
  ]

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* 좌측: 계좌 목록 */}
      <nav
        aria-label="규칙 적용 계좌"
        className="shrink-0 rounded-lg border p-2 lg:sticky lg:top-4 lg:w-60"
      >
        <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">적용 계좌</p>
        <ul className="space-y-0.5">
          {scopeItems.map((it) => (
            <li key={it.value}>
              <button
                type="button"
                onClick={() => setScope(it.value)}
                aria-current={scope === it.value ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                  scope === it.value && 'bg-muted font-medium'
                )}
              >
                <span className="truncate">{it.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {it.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* 우측: 검색·필터 + 표 */}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="키워드·계정과목·메모 검색"
              aria-label="규칙 검색"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={matchFilter} onValueChange={(v) => setMatchFilter(v as 'ALL' | MatchType)}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label="일치 방식 필터">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">일치 방식 전체</SelectItem>
              <SelectItem value="EXACT">완전 일치</SelectItem>
              <SelectItem value="KEYWORD">부분 포함</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dirFilter} onValueChange={(v) => setDirFilter(v as 'ALL' | 'IN' | 'OUT')}>
            <SelectTrigger className="h-8 w-28 text-xs" aria-label="방향 필터">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">방향 전체</SelectItem>
              <SelectItem value="IN">수입</SelectItem>
              <SelectItem value="OUT">지출</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={unusedOnly}
              onCheckedChange={(v) => setUnusedOnly(v === true)}
              aria-label="미사용 규칙만"
            />
            미사용만
          </label>
          <Button size="sm" className="ml-auto h-8" onClick={() => setEditing('new')}>
            <Plus className="mr-1 size-3.5" />
            규칙 추가
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {loading ? '불러오는 중...' : `${visible.length.toLocaleString('ko-KR')}개 규칙`}
        </p>

        {!loading && visible.length === 0 ? (
          <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
            {rules.length === 0 ? '등록된 규칙이 없습니다' : '조건에 맞는 규칙이 없습니다'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>키워드</TableHead>
                  <TableHead className="w-16">일치</TableHead>
                  <TableHead className="w-14">방향</TableHead>
                  <TableHead>계정과목</TableHead>
                  {scope === 'ALL' && <TableHead>계좌</TableHead>}
                  <TableHead>메모</TableHead>
                  <TableHead className="w-16 text-right">매칭</TableHead>
                  <TableHead className="w-24">최근 매칭</TableHead>
                  <TableHead className="w-9" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow
                    key={r.id}
                    tabIndex={0}
                    onClick={() => setEditing(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setEditing(r)
                    }}
                    className="cursor-pointer text-xs"
                    aria-label={`규칙 ${r.matchKey} 수정`}
                  >
                    <TableCell className="max-w-[260px] truncate font-mono" title={r.matchKey}>
                      {r.matchKey}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {r.matchType === 'EXACT' ? '완전' : '부분'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.direction === 'IN' ? '수입' : r.direction === 'OUT' ? '지출' : '—'}
                    </TableCell>
                    <TableCell>{categoryLabelOf(r.category) || '(삭제된 계정)'}</TableCell>
                    {scope === 'ALL' && (
                      <TableCell className="text-muted-foreground">
                        {r.account ? r.account.name : '전체 공통'}
                      </TableCell>
                    )}
                    <TableCell
                      className="max-w-[180px] truncate text-muted-foreground"
                      title={r.memo ?? ''}
                    >
                      {r.memo ?? ''}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.usage.count > 0 ? (
                        r.usage.count.toLocaleString('ko-KR')
                      ) : (
                        <span className="text-muted-foreground">미사용</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {r.usage.lastMatchedAt ? ymdOf(r.usage.lastMatchedAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label={`규칙 ${r.matchKey} 삭제`}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(r)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {editing && (
        <RuleDialog
          key={editing === 'new' ? 'new' : editing.id}
          mode={editing}
          accounts={accounts}
          leafTargets={leafTargets}
          defaultAccountId={scope === 'ALL' || scope === 'COMMON' ? null : scope}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

// ─── 추가/수정 팝업 ────────────────────────────────────────────────────────────

type Preview = {
  /** ruleId 지정 시 — 기존 거래 함께 변경 대상 수(PATCH 와 같은 기준) */
  applicableCount: number | null
  count: number
  sameCategoryCount: number
  samples: {
    id: string
    txnDate: string
    description: string | null
    counterparty: string | null
    account: { name: string }
  }[]
}

async function fetchPreview(body: {
  matchKey: string
  matchType: MatchType
  accountId: string | null
  categoryId: string
  /** 수정 중 규칙 — 이체 등 방향 없는 계정과목이면 이 규칙의 방향으로 미리보기 */
  ruleId?: string
}): Promise<Preview | null> {
  const res = await fetch('/api/finance/rules/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.ok ? res.json() : null
}

function RuleDialog({
  mode,
  accounts,
  leafTargets,
  defaultAccountId,
  onClose,
  onSaved,
}: {
  mode: Rule | 'new'
  accounts: Account[]
  leafTargets: ComboOption[]
  defaultAccountId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = mode === 'new' ? null : mode
  const [matchKey, setMatchKey] = useState(editing?.matchKey ?? '')
  const [matchType, setMatchType] = useState<MatchType>(editing?.matchType ?? 'KEYWORD')
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null)
  const [accountValue, setAccountValue] = useState<string>(
    editing ? (editing.accountId ?? COMMON_VALUE) : (defaultAccountId ?? COMMON_VALUE)
  )
  const [memo, setMemo] = useState(editing?.memo ?? '')
  const [applyToExisting, setApplyToExisting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  // 수정 모드: 원래 조건에 걸리고 계정과목이 그대로인 거래 수 — 「기존 거래도 함께 변경」 대상.
  const [originalSameCount, setOriginalSameCount] = useState(0)

  const accountId = accountValue === COMMON_VALUE ? null : accountValue

  useEffect(() => {
    if (!editing) return
    void fetchPreview({
      matchKey: editing.matchKey,
      matchType: editing.matchType,
      accountId: editing.accountId,
      categoryId: editing.categoryId,
      ruleId: editing.id,
    }).then((p) => setOriginalSameCount(p?.applicableCount ?? 0))
  }, [editing])

  // 입력이 바뀌면 400ms 뒤 미리보기 갱신(키워드·계정과목이 비어 있으면 결과만 숨김).
  const previewKey =
    matchKey.trim() && categoryId ? `${matchKey}|${matchType}|${accountValue}|${categoryId}` : ''
  useEffect(() => {
    if (!previewKey || !categoryId) return
    const t = setTimeout(() => {
      void fetchPreview({ matchKey, matchType, accountId, categoryId, ruleId: editing?.id }).then(
        setPreview
      )
    }, 400)
    return () => clearTimeout(t)
  }, [previewKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const categoryChanged = !!editing && !!categoryId && categoryId !== editing.categoryId

  async function save() {
    if (!matchKey.trim()) {
      toast.error('키워드를 입력해 주세요')
      return
    }
    if (!categoryId) {
      toast.error('대상 계정과목을 선택해 주세요')
      return
    }
    setSaving(true)
    setConflict(null)
    try {
      const body = editing
        ? {
            matchKey,
            matchType,
            categoryId,
            accountId,
            memo: memo.trim() || null,
            applyToExisting: categoryChanged && applyToExisting,
          }
        : { matchKey, matchType, categoryId, accountId, memo: memo.trim() || null }
      const res = await fetch(editing ? `/api/finance/rules/${editing.id}` : '/api/finance/rules', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setConflict(
          `같은 조건의 규칙이 이미 있습니다: 〈${data?.existing?.categoryLabel ?? ''}〉 — 그 규칙을 수정하세요`
        )
        return
      }
      if (!res.ok) throw new Error(data?.message ?? '규칙 저장 실패')
      const extra = [
        data?.updatedTransactions ? `기존 거래 ${data.updatedTransactions}건 변경` : '',
        data?.reclassifiedStaged ? `대기 ${data.reclassifiedStaged}건 재분류` : '',
      ]
        .filter(Boolean)
        .join(', ')
      toast.success(
        `${editing ? '규칙을 수정했습니다' : '규칙을 추가했습니다'}${extra ? ` (${extra})` : ''}`
      )
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '규칙 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? '분류 규칙 수정' : '분류 규칙 추가'}</DialogTitle>
          <DialogDescription>
            적요·거래상대에 키워드가 걸리면 계정과목으로 분류합니다. 방향(수입/지출)은 계정과목에서
            정해집니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="space-y-1">
              <Label htmlFor="rule-key" className="text-xs">
                키워드
              </Label>
              <Input
                id="rule-key"
                value={matchKey}
                onChange={(e) => setMatchKey(e.target.value)}
                placeholder="예: 택배, 쿠팡"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">일치 방식</Label>
              <Select value={matchType} onValueChange={(v) => setMatchType(v as MatchType)}>
                <SelectTrigger className="h-8 w-28 text-xs" aria-label="일치 방식">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXACT">완전 일치</SelectItem>
                  <SelectItem value="KEYWORD">부분 포함</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">계정과목</Label>
            <CategoryCombobox
              options={leafTargets}
              value={categoryId}
              onChange={setCategoryId}
              placeholder="대상 계정과목"
              triggerClassName="h-8 w-full text-xs"
              groupByType
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">적용 계좌</Label>
            <Select value={accountValue} onValueChange={setAccountValue}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="적용 계좌">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={COMMON_VALUE}>전체 공통 (모든 계좌)</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {accountKindLabel(a.kind)} · {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rule-memo" className="text-xs">
              메모
            </Label>
            <Textarea
              id="rule-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={MEMO_MAX}
              rows={2}
              placeholder="자동 분류된 거래에 함께 적을 메모 (선택)"
              className="text-xs"
            />
          </div>

          {/* 매칭 미리보기 */}
          {previewKey && preview && (
            <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
              <p className="font-medium">
                이 조건에 걸리는 확정 거래{' '}
                <span className="tabular-nums">{preview.count.toLocaleString('ko-KR')}</span>건
              </p>
              {preview.samples.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                  {preview.samples.map((s) => (
                    <li key={s.id} className="truncate">
                      <span className="font-mono">{ymdOf(s.txnDate)}</span> · {s.account.name} ·{' '}
                      {[s.description, s.counterparty].filter(Boolean).join(' / ')}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                다른 규칙과의 우선순위는 반영하지 않은 범위입니다
              </p>
            </div>
          )}

          {categoryChanged && originalSameCount > 0 && (
            <label className="flex items-start gap-2 text-xs">
              <Checkbox
                checked={applyToExisting}
                onCheckedChange={(v) => setApplyToExisting(v === true)}
                className="mt-0.5"
              />
              <span>
                이 규칙으로 분류된 기존 거래 {originalSameCount.toLocaleString('ko-KR')}건도 함께
                변경
                <span className="block text-[11px] text-muted-foreground">
                  이후 다른 계정과목으로 직접 바꾼 거래는 그대로 둡니다
                </span>
              </span>
            </label>
          )}

          {conflict && (
            <p role="alert" className="text-xs text-destructive">
              {conflict}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
