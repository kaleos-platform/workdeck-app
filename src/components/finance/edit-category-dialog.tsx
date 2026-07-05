'use client'

/**
 * 운영 계정 편집 다이얼로그 — 이름 / 고정·변동(지출 리프만) / 상위 대분류(리프, 같은 타입).
 * K-IFRS 매핑은 여기서 다루지 않음(회계용 내보내기 단계에서 처리). PATCH /api/finance/categories/[id].
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { InfoHint } from '@/components/finance/info-hint'
import { FLOW_ROLE_GUIDE, COST_NATURE_GUIDE } from '@/components/finance/format'

export type EditNode = {
  id: string
  name: string
  type: string
  groupLabel: string | null
  flowRole: string | null
  parentId: string | null
}

// 손익 흐름도 역할 옵션 — 대분류(수입/지출)에만 노출.
// 미지정: 수입=기타수익, 지출=판매관리비(OPEX)로 흐름도가 처리한다.
const FLOW_ROLE_OPTIONS: Record<'INCOME' | 'EXPENSE', { value: string; label: string }[]> = {
  INCOME: [
    { value: 'none', label: '미지정 (기타수익)' },
    { value: 'MERCH_SALES', label: '상품매출' },
  ],
  EXPENSE: [
    { value: 'none', label: '미지정 (판매관리비)' },
    { value: 'COGS', label: '매출원가' },
    { value: 'OPEX', label: '영업비용(판관비)' },
    { value: 'FINANCING_COST', label: '금융비용' },
  ],
}

/** flowRole 옵션 값 → 안내 텍스트(옵션 아래 보조 설명). */
function flowOptionGuide(value: string, type: 'INCOME' | 'EXPENSE'): string {
  if (value === 'MERCH_SALES') return FLOW_ROLE_GUIDE.MERCH_SALES
  if (value === 'COGS') return FLOW_ROLE_GUIDE.COGS
  if (value === 'OPEX') return FLOW_ROLE_GUIDE.OPEX
  if (value === 'FINANCING_COST') return FLOW_ROLE_GUIDE.FINANCING_COST
  // none
  return type === 'INCOME' ? FLOW_ROLE_GUIDE.OTHER_INCOME : '별도 지정 안 함 — 판매관리비로 집계됩니다.'
}

export function EditCategoryDialog({
  open,
  onOpenChange,
  node,
  isLeaf,
  parentGroups,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: EditNode | null
  /** 리프(운영 항목)면 true — 고정/변동·상위 대분류 노출. 대분류면 false(이름만). */
  isLeaf: boolean
  /** 같은 타입의 대분류 목록(리프의 상위 이동 옵션) */
  parentGroups: { id: string; name: string }[]
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [groupLabel, setGroupLabel] = useState('')
  const [parentId, setParentId] = useState('')
  const [flowRole, setFlowRole] = useState('none')
  const [saving, setSaving] = useState(false)

  const isExpenseLeaf = isLeaf && node?.type === 'EXPENSE'
  // 대분류(수입/지출)면 흐름도 역할 노출.
  const flowRoleOptions =
    !isLeaf && (node?.type === 'INCOME' || node?.type === 'EXPENSE')
      ? FLOW_ROLE_OPTIONS[node.type]
      : null

  useEffect(() => {
    if (node && open) {
      setName(node.name)
      setGroupLabel(node.groupLabel ?? '')
      setParentId(node.parentId ?? '')
      setFlowRole(node.flowRole ?? 'none')
    }
  }, [node, open])

  if (!node) return null

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('이름을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { name: trimmed }
      if (isExpenseLeaf) body.groupLabel = groupLabel || null
      if (isLeaf && parentId && parentId !== node!.parentId) body.parentId = parentId
      if (flowRoleOptions) body.flowRole = flowRole === 'none' ? null : flowRole

      const res = await fetch(`/api/finance/categories/${node!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success('저장되었습니다')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isLeaf ? '항목 편집' : '대분류 편집'}</DialogTitle>
          <DialogDescription>
            {isLeaf
              ? '이름·원가 성격·상위 대분류를 수정합니다.'
              : '대분류 이름·손익 흐름도 역할을 수정합니다.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">이름</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 text-sm"
              maxLength={100}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave()
              }}
            />
          </div>

          {isExpenseLeaf && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label className="text-xs">원가 성격</Label>
                <InfoHint
                  content={
                    <div className="space-y-1">
                      <p>
                        <span className="font-semibold">고정비</span> — {COST_NATURE_GUIDE.고정}
                      </p>
                      <p>
                        <span className="font-semibold">변동비</span> — {COST_NATURE_GUIDE.변동}
                      </p>
                    </div>
                  }
                />
              </div>
              <Select
                value={groupLabel || 'none'}
                onValueChange={(v) => setGroupLabel(v === 'none' ? '' : v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">미지정</SelectItem>
                  <SelectItem value="고정">고정비</SelectItem>
                  <SelectItem value="변동">변동비</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                현금흐름 상세 &lsquo;하위만&rsquo; 보기에서 고정/변동 그룹으로 분류됩니다.
              </p>
            </div>
          )}

          {flowRoleOptions && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label className="text-xs">손익 분류 (흐름도)</Label>
                <InfoHint
                  content={
                    <div className="space-y-1">
                      {flowRoleOptions
                        .filter((o) => o.value !== 'none')
                        .map((o) => (
                          <p key={o.value}>
                            <span className="font-semibold">{o.label}</span> —{' '}
                            {flowOptionGuide(o.value, node!.type as 'INCOME' | 'EXPENSE')}
                          </p>
                        ))}
                    </div>
                  }
                />
              </div>
              <Select value={flowRole} onValueChange={setFlowRole}>
                <SelectTrigger className="h-auto min-h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {flowRoleOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="flex flex-col items-start">
                        <span>{o.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {flowOptionGuide(o.value, node!.type as 'INCOME' | 'EXPENSE')}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                현금흐름 상세의 흐름도(Sankey) 손익 계층 분류에 사용됩니다.
              </p>
            </div>
          )}

          {isLeaf && parentGroups.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">상위 대분류</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="대분류 선택" />
                </SelectTrigger>
                <SelectContent>
                  {parentGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                같은 구분 내 대분류로만 이동됩니다.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
