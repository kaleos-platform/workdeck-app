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

export type EditNode = {
  id: string
  name: string
  type: string
  groupLabel: string | null
  parentId: string | null
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
  const [saving, setSaving] = useState(false)

  const isExpenseLeaf = isLeaf && node?.type === 'EXPENSE'

  useEffect(() => {
    if (node && open) {
      setName(node.name)
      setGroupLabel(node.groupLabel ?? '')
      setParentId(node.parentId ?? '')
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
            {isLeaf ? '이름·원가 성격·상위 대분류를 수정합니다.' : '대분류 이름을 수정합니다.'}
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
              <Label className="text-xs">원가 성격</Label>
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
