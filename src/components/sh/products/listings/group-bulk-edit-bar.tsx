'use client'

import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  FloatingActionBar,
  floatingActionButtonClass,
  floatingActionButtonDestructiveClass,
  floatingActionInputClass,
  floatingActionSelectTriggerClass,
} from '@/components/ui/floating-action-bar'
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
  channelAllocation?: number | null
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
  const [channelAllocationDraft, setChannelAllocationDraft] = useState('')
  const [statusDraft, setStatusDraft] = useState<'' | 'ACTIVE' | 'SUSPENDED'>('')

  const hasChange =
    retailDraft.trim() !== '' || channelAllocationDraft.trim() !== '' || statusDraft !== ''

  async function apply() {
    const patch: BulkPatch = {}
    if (retailDraft.trim() !== '') patch.retailPrice = Number(retailDraft)
    if (channelAllocationDraft.trim() !== '') {
      patch.channelAllocation = Number(channelAllocationDraft)
    }
    if (statusDraft !== '') patch.status = statusDraft
    if (
      patch.retailPrice === undefined &&
      patch.channelAllocation === undefined &&
      patch.status === undefined
    ) {
      return
    }
    await onApply(patch)
    setRetailDraft('')
    setChannelAllocationDraft('')
    setStatusDraft('')
  }

  return (
    <FloatingActionBar
      open={selectedCount > 0}
      onClear={onClear}
      clearDisabled={loading}
      actions={
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-background/70">판매가</span>
            <Input
              type="number"
              min={0}
              value={retailDraft}
              onChange={(e) => setRetailDraft(e.target.value)}
              placeholder="변경 없음"
              className={`${floatingActionInputClass} w-28`}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-background/70">재고</span>
            <Input
              type="number"
              min={0}
              value={channelAllocationDraft}
              onChange={(e) => setChannelAllocationDraft(e.target.value)}
              placeholder="변경 없음"
              className={`${floatingActionInputClass} w-28`}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-background/70">판매상태</span>
            <Select
              value={statusDraft || 'none'}
              onValueChange={(v) =>
                setStatusDraft(v === 'none' ? '' : (v as 'ACTIVE' | 'SUSPENDED'))
              }
            >
              <SelectTrigger className={`${floatingActionSelectTriggerClass} w-28`}>
                <SelectValue placeholder="변경 없음" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">변경 없음</SelectItem>
                <SelectItem value="ACTIVE">판매중</SelectItem>
                <SelectItem value="SUSPENDED">판매중지</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={floatingActionButtonClass}
            onClick={apply}
            disabled={!hasChange || loading}
          >
            {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            일괄 적용
          </Button>
          {onRequestDelete && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonDestructiveClass}
              onClick={onRequestDelete}
              disabled={loading}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              선택 삭제
            </Button>
          )}
        </>
      }
    >
      <span className="text-sm font-semibold">{selectedCount}개 선택됨</span>
    </FloatingActionBar>
  )
}
