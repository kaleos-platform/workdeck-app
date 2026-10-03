'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CategoryCombobox } from '@/components/finance/category-combobox'
import { buildParentOptions, type CategoryTreeNode } from '@/lib/finance/category-options'

/**
 * 계정과목 추가 다이얼로그(공유). 상위 계정과목(수익/비용/이체) 아래에 새 계정과목을 만들고
 * onCreated로 호출부가 재조회·즉시 적용을 처리한다. 거래내역 페이지·현금흐름 편집 팝오버 공용.
 */
export function AddCategoryDialog({
  open,
  onOpenChange,
  categoryTree,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categoryTree: CategoryTreeNode[]
  onCreated: (category: { id: string }) => Promise<void> | void
}) {
  const [parentId, setParentId] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const parentOptions = useMemo(() => buildParentOptions(categoryTree), [categoryTree])

  async function handleSave() {
    if (!parentId) {
      toast.error('상위 계정과목을 선택해 주세요')
      return
    }
    if (!name.trim()) {
      toast.error('계정과목 이름을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/finance/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, name: name.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        message?: string
        category?: { id: string }
      }
      if (!res.ok || !data.category) throw new Error(data?.message ?? '계정과목 추가 실패')
      toast.success('계정과목이 추가되어 이 거래에 적용되었습니다')
      setName('')
      setParentId('')
      onOpenChange(false)
      await onCreated(data.category)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '계정과목 추가 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>계정과목 추가</DialogTitle>
          <DialogDescription>
            상위 계정과목 아래에 새 계정과목을 추가하고 이 거래에 바로 적용합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">상위 계정과목</Label>
            <CategoryCombobox
              options={parentOptions}
              value={parentId || null}
              onChange={setParentId}
              placeholder="수익 / 비용 / 이체 선택"
              triggerClassName="h-9 w-full text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">계정과목 이름</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 플랫폼 수수료"
              className="h-9 text-sm"
              maxLength={100}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave()
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '추가 중...' : '추가하고 적용'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
