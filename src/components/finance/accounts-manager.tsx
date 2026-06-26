'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, Tag } from 'lucide-react'
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
import type { FinCategoryType } from '@/generated/prisma/enums'
import { categoryTypeBadge } from '@/components/finance/format'
import { CategoryCombobox } from '@/components/finance/category-combobox'
import { buildClassifyOptions, type ComboOption } from '@/lib/finance/category-options'

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

export function FinanceAccountsManager() {
  const [tree, setTree] = useState<Category[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)

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

  return (
    <Tabs defaultValue="categories" className="space-y-4">
      <TabsList>
        <TabsTrigger value="categories">계정과목</TabsTrigger>
        <TabsTrigger value="rules">
          자동 분류 규칙
          {rules.length > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">{rules.length}</span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="categories">
        <CategoryTree tree={tree} loading={loading} onChanged={load} />
      </TabsContent>

      <TabsContent value="rules">
        <RuleManager rules={rules} leafTargets={leafTargets} loading={loading} onChanged={load} />
      </TabsContent>
    </Tabs>
  )
}

// ─── 계정과목 트리 ──────────────────────────────────────────────────────────────

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>계정과목 체계</CardTitle>
        <CardDescription>
          K-IFRS 표준 계정과목. 수익·비용 계정은 펼쳐서 사용자 하위 계정을 추가할 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {tree.map((root) => {
          const badge = categoryTypeBadge(root.type)
          const editable = root.type === 'INCOME' || root.type === 'EXPENSE'
          return (
            <div key={root.id} className="space-y-1">
              <div className="flex items-center gap-2 border-b pb-1.5">
                <Badge variant="outline" className={badge.className}>
                  {badge.label}
                </Badge>
                <span className="text-sm font-semibold">{root.name}</span>
                {root.code && (
                  <span className="font-mono text-xs text-muted-foreground">{root.code}</span>
                )}
              </div>

              <div className="divide-y">
                {root.children.map((lvl1) => (
                  <Lvl1Row
                    key={lvl1.id}
                    node={lvl1}
                    editable={editable}
                    expanded={expanded.has(lvl1.id)}
                    onToggle={() => toggle(lvl1.id)}
                    onChanged={onChanged}
                  />
                ))}
                {root.children.length === 0 && (
                  <p className="py-2 text-xs text-muted-foreground">하위 계정과목이 없습니다</p>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function Lvl1Row({
  node,
  editable,
  expanded,
  onToggle,
  onChanged,
}: {
  node: Category
  editable: boolean
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const subCount = node.children.length
  const txnCount = node._count?.transactions ?? 0
  const canExpand = editable

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
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
        {node.code && <span className="font-mono text-xs text-muted-foreground">{node.code}</span>}
        <span className="text-sm font-medium">{node.name}</span>
        {node.groupLabel && (
          <Badge variant="secondary" className="text-xs">
            {node.groupLabel}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {canExpand && <span>하위 {subCount}</span>}
          <span>거래 {txnCount.toLocaleString('ko-KR')}</span>
        </div>
      </div>

      {canExpand && expanded && (
        <div className="mt-1 ml-7 space-y-1 border-l pl-3">
          {node.children.map((sub) => (
            <SubAccountRow key={sub.id} node={sub} onChanged={onChanged} />
          ))}
          <AddSubAccount parentId={node.id} onChanged={onChanged} />
        </div>
      )}
    </div>
  )
}

function SubAccountRow({ node, onChanged }: { node: Category; onChanged: () => void }) {
  async function handleDelete() {
    if (!confirm(`하위 계정 "${node.name}"을(를) 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/finance/categories/${node.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('하위 계정이 삭제되었습니다')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-sm">{node.name}</span>
      {node.alias && <span className="text-xs text-muted-foreground">{node.alias}</span>}
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span>거래 {(node._count?.transactions ?? 0).toLocaleString('ko-KR')}</span>
        <Button variant="ghost" size="icon-xs" onClick={handleDelete} aria-label="삭제">
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function AddSubAccount({ parentId, onChanged }: { parentId: string; onChanged: () => void }) {
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
      toast.success('하위 계정이 추가되었습니다')
      setName('')
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
        placeholder="하위 계정 이름"
        className="h-8 max-w-56 text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleAdd()
        }}
      />
      <Button size="sm" variant="outline" onClick={handleAdd} disabled={saving || !name.trim()}>
        <Plus className="mr-1 size-3.5" />
        추가
      </Button>
    </div>
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
