'use client'

import { useState } from 'react'
import { Loader2, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type BulkPatch = {
  retailPrice?: number | null
  status?: 'ACTIVE' | 'SUSPENDED'
}

type Props = {
  selectedCount: number
  onClear: () => void
  onApply: (patch: BulkPatch) => Promise<void>
  onRequestDelete?: () => void
  loading?: boolean
}

export function GroupBulkEditBar({
  selectedCount,
  onClear,
  onApply,
  onRequestDelete,
  loading,
}: Props) {
  const [retailDraft, setRetailDraft] = useState('')
  const [statusDraft, setStatusDraft] = useState<'' | 'ACTIVE' | 'SUSPENDED'>('')

  const hasChange = retailDraft.trim() !== '' || statusDraft !== ''

  async function apply() {
    const patch: BulkPatch = {}
    if (retailDraft.trim() !== '') patch.retailPrice = Number(retailDraft)
    if (statusDraft !== '') patch.status = statusDraft
    if (!patch.retailPrice && !patch.status) return
    await onApply(patch)
    setRetailDraft('')
    setStatusDraft('')
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-primary/5 px-3 py-2 text-sm">
      <span className="font-medium">{selectedCount}개 선택됨</span>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">판매가</span>
        <Input
          type="number"
          min={0}
          value={retailDraft}
          onChange={(e) => setRetailDraft(e.target.value)}
          placeholder="변경 없음"
          className="h-8 w-28"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">판매상태</span>
        <Select
          value={statusDraft || 'none'}
          onValueChange={(v) => setStatusDraft(v === 'none' ? '' : (v as 'ACTIVE' | 'SUSPENDED'))}
        >
          <SelectTrigger className="h-8 w-28">
            <SelectValue placeholder="변경 없음" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">변경 없음</SelectItem>
            <SelectItem value="ACTIVE">판매중</SelectItem>
            <SelectItem value="SUSPENDED">판매중지</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <Button size="sm" onClick={apply} disabled={!hasChange || loading}>
          {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          일괄 적용
        </Button>
        <Button variant="outline" size="sm" onClick={onClear} disabled={loading}>
          <X className="mr-1 h-4 w-4" />
          선택 해제
        </Button>
        {onRequestDelete && (
          <Button variant="destructive" size="sm" onClick={onRequestDelete} disabled={loading}>
            <Trash2 className="mr-1 h-4 w-4" />
            선택 삭제
          </Button>
        )}
      </div>
    </div>
  )
}
