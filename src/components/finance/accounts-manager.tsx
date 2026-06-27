'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Tag,
  Pencil,
  EyeOff,
  Eye,
  Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import type { FinCategoryType } from '@/generated/prisma/enums'
import { categoryTypeBadge } from '@/components/finance/format'
import { CategoryCombobox } from '@/components/finance/category-combobox'
import { buildClassifyOptions, type ComboOption } from '@/lib/finance/category-options'
import { EditCategoryDialog } from '@/components/finance/edit-category-dialog'
import { KIFRS_ACCOUNT_OPTIONS } from '@/lib/finance/kifrs-map'

type Category = {
  id: string
  parentId: string | null
  name: string
  code: string | null
  alias: string | null
  type: FinCategoryType
  groupLabel: string | null
  isSystem: boolean
  isActive: boolean
  sortOrder: number
  _count?: { transactions: number }
  children: Category[]
}

type Rule = {
  id: string
  matchKey: string
  matchType: 'EXACT' | 'KEYWORD'
  learnedFrom: 'USER' | 'SEED'
  category: { id: string; name: string; parent?: { name: string } | null } | null
}

// 운영 계정 화면은 분류 대상(수입/지출/이체)만. 자산/부채는 "계좌 관리" 메뉴에서 다룬다.
const CLASSIFY_TYPES: FinCategoryType[] = ['INCOME', 'EXPENSE', 'TRANSFER']

/** 대분류의 사용량 = 하위 리프 거래 합산(대분류 자체 _count는 0). 리프는 자기 거래수. */
function nodeUsage(node: Category): number {
  if (node.children.length > 0) {
    return node.children.reduce((s, c) => s + (c._count?.transactions ?? 0), 0)
  }
  return node._count?.transactions ?? 0
}

function downloadExportCsv() {
  const a = document.createElement('a')
  a.href = '/api/finance/export'
  a.click()
}

export function FinanceAccountsManager() {
  const [tree, setTree] = useState<Category[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [exportItems, setExportItems] = useState<{ id: string; name: string; group: string }[]>([])
  const [exportOpen, setExportOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [catRes, ruleRes] = await Promise.all([
        fetch('/api/finance/categories'),
        fetch('/api/finance/rules'),
      ])
      if (!catRes.ok) throw new Error('계정과목 조회 실패')
      if (!ruleRes.ok) throw new Error('규칙 조회 실패')
      const catData = await catRes.json()
      const ruleData = await ruleRes.json()
      setTree(catData.tree ?? [])
      setRules(ruleData.rules ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const leafTargets = useMemo(() => buildClassifyOptions(tree, ['INCOME', 'EXPENSE']), [tree])

  // 회계용 내보내기: 거래가 있는데 K-IFRS 코드가 없는(사용자추가) 항목이 있으면 매핑 검토 후 다운로드.
  const handleExport = () => {
    const unmapped: { id: string; name: string; group: string }[] = []
    for (const root of tree) {
      if (root.type !== 'INCOME' && root.type !== 'EXPENSE') continue
      for (const group of root.children) {
        for (const leaf of group.children) {
          if (!leaf.code && (leaf._count?.transactions ?? 0) > 0) {
            unmapped.push({ id: leaf.id, name: leaf.name, group: group.name })
          }
        }
      }
    }
    if (unmapped.length === 0) {
      downloadExportCsv()
      return
    }
    setExportItems(unmapped)
    setExportOpen(true)
  }

  return (
    <Tabs defaultValue="categories" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="categories">운영 계정</TabsTrigger>
          <TabsTrigger value="rules">
            자동 분류 규칙
            {rules.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">{rules.length}</span>
            )}
          </TabsTrigger>
        </TabsList>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          title="확정 거래를 K-IFRS 회계 기준(코드·현금흐름)으로 환원한 CSV로 내보냅니다"
        >
          <Download className="mr-1 size-3.5" />
          회계용 내보내기 (CSV)
        </Button>
      </div>

      <TabsContent value="categories">
        <CategoryTree tree={tree} loading={loading} onChanged={load} />
      </TabsContent>

      <TabsContent value="rules">
        <RuleManager rules={rules} leafTargets={leafTargets} loading={loading} onChanged={load} />
      </TabsContent>

      <ExportMappingDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        items={exportItems}
        onMapped={async () => {
          await load()
          downloadExportCsv()
        }}
      />
    </Tabs>
  )
}

// ─── 운영 계정 트리 ─────────────────────────────────────────────────────────────

function CategoryTree({
  tree,
  loading,
  onChanged,
}: {
  tree: Category[]
  loading: boolean
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  const roots = tree.filter((r) => CLASSIFY_TYPES.includes(r.type))

  return (
    <Card>
      <CardHeader>
        <CardTitle>운영 계정 체계</CardTitle>
        <CardDescription>
          거래를 분류하는 수입·지출·이체 항목입니다. 항목을 펼쳐 추가·편집(이름·고정/변동·상위
          이동)하거나, 안 쓰는 항목은 비활성화·삭제할 수 있습니다. (자산·부채는 계좌 관리 메뉴에서
          관리)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {roots.map((root) => {
          const badge = categoryTypeBadge(root.type)
          const editable = root.type === 'INCOME' || root.type === 'EXPENSE'
          // 같은 타입 대분류 목록(리프 상위 이동 옵션)
          const groupOptions = root.children
            .filter((c) => c.children.length > 0)
            .map((c) => ({ id: c.id, name: c.name }))
          return (
            <div key={root.id} className="space-y-1">
              <div className="flex items-center gap-2 border-b pb-1.5">
                <Badge variant="outline" className={badge.className}>
                  {badge.label}
                </Badge>
                <span className="text-sm font-semibold">{root.name}</span>
              </div>

              <div className="divide-y">
                {root.children.map((lvl1) => (
                  <Lvl1Row
                    key={lvl1.id}
                    node={lvl1}
                    editable={editable}
                    groupOptions={groupOptions}
                    expanded={expanded.has(lvl1.id)}
                    onToggle={() => toggle(lvl1.id)}
                    onChanged={onChanged}
                  />
                ))}
                {root.children.length === 0 && (
                  <p className="py-2 text-xs text-muted-foreground">항목이 없습니다</p>
                )}
              </div>

              {editable && <AddGroup parentId={root.id} onChanged={onChanged} />}
              {root.type === 'TRANSFER' && (
                <AddSubAccount
                  parentId={root.id}
                  isExpense={false}
                  placeholder="새 이체 항목 (예: 보증금 대체)"
                  onChanged={onChanged}
                />
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

/** 사용 여부 배지(거래 있으면 '사용 중', 정확 건수는 툴팁). */
function UsageBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <Badge
      variant="outline"
      className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
      title={`거래 ${count.toLocaleString('ko-KR')}건`}
    >
      사용 중
    </Badge>
  )
}

// 대분류(INCOME/EXPENSE) 또는 이체 리프(TRANSFER)를 렌더. hasChildren로 분기.
function Lvl1Row({
  node,
  editable,
  groupOptions,
  expanded,
  onToggle,
  onChanged,
}: {
  node: Category
  editable: boolean
  groupOptions: { id: string; name: string }[]
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const hasChildren = node.children.length > 0
  const canExpand = editable && hasChildren
  const usage = nodeUsage(node)

  async function handleDelete() {
    const warn = hasChildren
      ? `대분류 "${node.name}"을(를) 삭제하면 하위 ${node.children.length}개 항목과 연결된 ${usage.toLocaleString('ko-KR')}건의 거래 분류가 모두 해제됩니다(거래는 보존). 계속할까요?`
      : `"${node.name}"을(를) 삭제하시겠습니까?`
    if (!confirm(warn)) return
    try {
      const res = await fetch(`/api/finance/categories/${node.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('삭제되었습니다')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  async function toggleActive() {
    try {
      const res = await fetch(`/api/finance/categories/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !node.isActive }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '변경 실패')
      toast.success(node.isActive ? '비활성화했습니다' : '활성화했습니다')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변경 실패')
    }
  }

  return (
    <div className="py-1.5">
      <div className={`flex items-center gap-2 ${node.isActive ? '' : 'opacity-50'}`}>
        {canExpand ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            aria-label={expanded ? '접기' : '펼치기'}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="size-5" />
        )}
        <span className="text-sm font-medium">{node.name}</span>
        {!node.isActive && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            비활성
          </Badge>
        )}
        <UsageBadge count={usage} />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {hasChildren && <span>하위 {node.children.length}</span>}
          {/* 대분류: 이름변경 + 삭제 / 이체 리프: 편집·비활성·삭제(보호 아닐 때) */}
          <RowActionButtons
            canEdit={hasChildren || !node.isSystem}
            editLabel={hasChildren ? '이름 변경' : '편집'}
            onEdit={() => setEditOpen(true)}
            isActive={node.isActive}
            onToggle={!hasChildren ? () => void toggleActive() : undefined}
            canDelete={hasChildren || !node.isSystem}
            onDelete={() => void handleDelete()}
          />
        </div>
      </div>

      {canExpand && expanded && (
        <div className="mt-1 ml-7 space-y-1 border-l pl-3">
          {node.children.map((sub) => (
            <SubAccountRow
              key={sub.id}
              node={sub}
              groupOptions={groupOptions}
              onChanged={onChanged}
            />
          ))}
          <AddSubAccount
            parentId={node.id}
            isExpense={node.type === 'EXPENSE'}
            onChanged={onChanged}
          />
        </div>
      )}

      <EditCategoryDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        node={node}
        isLeaf={!hasChildren}
        parentGroups={groupOptions}
        onSaved={onChanged}
      />
    </div>
  )
}

function SubAccountRow({
  node,
  groupOptions,
  onChanged,
}: {
  node: Category
  groupOptions: { id: string; name: string }[]
  onChanged: () => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const txnCount = node._count?.transactions ?? 0

  async function handleDelete() {
    const warn =
      txnCount > 0
        ? `"${node.name}"을(를) 삭제하면 연결된 ${txnCount.toLocaleString('ko-KR')}건의 분류가 해제됩니다(거래는 보존). 보존하려면 삭제 대신 비활성화하세요. 계속할까요?`
        : `항목 "${node.name}"을(를) 삭제하시겠습니까?`
    if (!confirm(warn)) return
    try {
      const res = await fetch(`/api/finance/categories/${node.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('항목이 삭제되었습니다')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  async function toggleActive() {
    try {
      const res = await fetch(`/api/finance/categories/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !node.isActive }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '변경 실패')
      toast.success(node.isActive ? '항목을 비활성화했습니다' : '항목을 활성화했습니다')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변경 실패')
    }
  }

  return (
    <div className={`flex items-center gap-2 py-0.5 ${node.isActive ? '' : 'opacity-50'}`}>
      <span className="text-sm">{node.name}</span>
      {node.groupLabel && (
        <Badge variant="secondary" className="text-[10px]">
          {node.groupLabel}
        </Badge>
      )}
      {!node.isActive && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          비활성
        </Badge>
      )}
      <UsageBadge count={txnCount} />
      <div className="ml-auto flex items-center">
        <RowActionButtons
          canEdit
          onEdit={() => setEditOpen(true)}
          isActive={node.isActive}
          onToggle={() => void toggleActive()}
          canDelete
          onDelete={() => void handleDelete()}
        />
      </div>

      <EditCategoryDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        node={node}
        isLeaf
        parentGroups={groupOptions}
        onSaved={onChanged}
      />
    </div>
  )
}

/**
 * 행 끝 인라인 액션 버튼(편집·활성토글·삭제) — ⋯ 더보기 대신 행에 바로 노출.
 * onToggle 미전달(대분류)이면 토글 버튼 생략. 항상 표시(hover-only 금지)로 발견성 확보.
 */
function RowActionButtons({
  canEdit,
  editLabel = '편집',
  onEdit,
  isActive,
  onToggle,
  canDelete,
  onDelete,
}: {
  canEdit: boolean
  editLabel?: string
  onEdit: () => void
  isActive: boolean
  /** 리프만 활성/비활성 토글. 대분류는 undefined로 생략. */
  onToggle?: () => void
  canDelete: boolean
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      {canEdit && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onEdit}
          aria-label={editLabel}
          title={editLabel}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
      {onToggle && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          aria-label={isActive ? '비활성화' : '활성화'}
          title={isActive ? '비활성화' : '활성화'}
        >
          {isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
          aria-label="삭제"
          title="삭제"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

function AddSubAccount({
  parentId,
  isExpense,
  placeholder = '운영 항목 이름 (예: 택배비)',
  onChanged,
}: {
  parentId: string
  isExpense: boolean
  placeholder?: string
  onChanged: () => void
}) {
  const [name, setName] = useState('')
  const [groupLabel, setGroupLabel] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const res = await fetch('/api/finance/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId,
          name: trimmed,
          ...(isExpense && groupLabel ? { groupLabel } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '추가 실패')
      toast.success('항목이 추가되었습니다')
      setName('')
      setGroupLabel('')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '추가 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2 pt-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        className="h-8 max-w-56 text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleAdd()
        }}
      />
      {isExpense && (
        <Select
          value={groupLabel || 'none'}
          onValueChange={(v) => setGroupLabel(v === 'none' ? '' : v)}
        >
          <SelectTrigger className="h-8 w-24 text-xs">
            <SelectValue placeholder="성격" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">미지정</SelectItem>
            <SelectItem value="고정">고정비</SelectItem>
            <SelectItem value="변동">변동비</SelectItem>
          </SelectContent>
        </Select>
      )}
      <Button size="sm" variant="outline" onClick={handleAdd} disabled={saving || !name.trim()}>
        <Plus className="mr-1 size-3.5" />
        추가
      </Button>
    </div>
  )
}

// 대분류(level1) 추가 — 부모=수입/지출 루트.
function AddGroup({ parentId, onChanged }: { parentId: string; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const res = await fetch('/api/finance/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, name: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '추가 실패')
      toast.success('대분류가 추가되었습니다')
      setName('')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '추가 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2 pt-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="새 대분류 이름 (예: 물류·배송)"
        className="h-8 max-w-56 text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleAdd()
        }}
      />
      <Button size="sm" variant="ghost" onClick={handleAdd} disabled={saving || !name.trim()}>
        <Plus className="mr-1 size-3.5" />
        대분류 추가
      </Button>
    </div>
  )
}

// ─── 회계용 내보내기 매핑 검토 ──────────────────────────────────────────────────

/** 거래가 있는데 K-IFRS 코드가 없는 항목을 회계 계정에 매핑한 뒤 CSV 다운로드. */
function ExportMappingDialog({
  open,
  onOpenChange,
  items,
  onMapped,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: { id: string; name: string; group: string }[]
  onMapped: () => void | Promise<void>
}) {
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setMapping({})
  }, [open])

  const allMapped = items.length > 0 && items.every((it) => mapping[it.id])

  async function handleConfirm() {
    setSaving(true)
    try {
      const toMap = items.filter((it) => mapping[it.id])
      await Promise.all(
        toMap.map((it) =>
          fetch(`/api/finance/categories/${it.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: mapping[it.id] }),
          })
        )
      )
      onOpenChange(false)
      await onMapped()
    } catch {
      toast.error('매핑 저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>회계용 내보내기 — 매핑 확인</DialogTitle>
          <DialogDescription>
            아래 항목은 거래가 있지만 K-IFRS 회계 계정에 아직 매핑되지 않았습니다. 회계 계정을
            지정하면 내보내기 CSV에 반영됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{it.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{it.group}</p>
              </div>
              <Select
                value={mapping[it.id] ?? ''}
                onValueChange={(v) => setMapping((m) => ({ ...m, [it.id]: v }))}
              >
                <SelectTrigger className="h-8 w-56 text-xs">
                  <SelectValue placeholder="K-IFRS 계정 선택" />
                </SelectTrigger>
                <SelectContent>
                  {KIFRS_ACCOUNT_OPTIONS.map((o) => (
                    <SelectItem key={o.code} value={o.code} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter className="items-center">
          {!allMapped && (
            <span className="mr-auto text-[11px] text-muted-foreground">
              매핑하지 않은 항목은 CSV에서 코드 없이 출력됩니다.
            </span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving ? '처리 중...' : '매핑 후 내보내기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 자동 분류 규칙 ─────────────────────────────────────────────────────────────

function RuleManager({
  rules,
  leafTargets,
  loading,
  onChanged,
}: {
  rules: Rule[]
  leafTargets: ComboOption[]
  loading: boolean
  onChanged: () => void
}) {
  const [matchKey, setMatchKey] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [matchType, setMatchType] = useState<'EXACT' | 'KEYWORD'>('KEYWORD')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!matchKey.trim()) {
      toast.error('키워드를 입력해 주세요')
      return
    }
    if (!categoryId) {
      toast.error('대상 계정과목을 선택해 주세요')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/finance/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchKey: matchKey.trim(), categoryId, matchType }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '규칙 추가 실패')
      toast.success('분류 규칙이 추가되었습니다')
      setMatchKey('')
      setCategoryId('')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '규칙 추가 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(rule: Rule) {
    if (!confirm(`규칙 "${rule.matchKey}"을(를) 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/finance/rules/${rule.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('규칙이 삭제되었습니다')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>자동 분류 규칙</CardTitle>
        <CardDescription>
          적요·가맹점 키워드를 계정과목에 매핑합니다. 거래 내역에서 직접 분류하면 규칙이 자동
          학습됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 규칙 추가 */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <Input
            value={matchKey}
            onChange={(e) => setMatchKey(e.target.value)}
            placeholder="키워드 (예: 택배, 쿠팡)"
            className="h-8 max-w-48 text-sm"
          />
          <Select value={matchType} onValueChange={(v) => setMatchType(v as 'EXACT' | 'KEYWORD')}>
            <SelectTrigger className="h-8 w-28 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="KEYWORD">부분 포함</SelectItem>
              <SelectItem value="EXACT">완전 일치</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">→</span>
          <CategoryCombobox
            options={leafTargets}
            value={categoryId || null}
            onChange={setCategoryId}
            placeholder="대상 계정과목"
            triggerClassName="h-8 w-56 text-sm"
          />
          <Button size="sm" onClick={handleAdd} disabled={saving}>
            <Plus className="mr-1 size-3.5" />
            규칙 추가
          </Button>
        </div>

        {/* 규칙 목록 */}
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 규칙이 없습니다</p>
        ) : (
          <div className="divide-y">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2 py-2">
                <Tag className="size-3.5 text-muted-foreground" />
                <Badge variant="secondary" className="font-mono text-xs">
                  {rule.matchKey}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {rule.matchType === 'EXACT' ? '완전' : '부분'}
                </Badge>
                <span className="text-xs text-muted-foreground">→</span>
                <span className="text-sm">
                  {rule.category?.parent?.name ? `${rule.category.parent.name} › ` : ''}
                  {rule.category?.name ?? '(삭제된 계정)'}
                </span>
                {rule.learnedFrom === 'SEED' && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    기본
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  onClick={() => handleDelete(rule)}
                  aria-label="삭제"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
