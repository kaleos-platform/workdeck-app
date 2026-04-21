'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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

type FeeRate = {
  id: string
  categoryName: string
  ratePercent: number
  vatIncluded: boolean
}

type Props = {
  channelId: string
}

/**
 * 채널 행 확장 시 표시되는 카테고리별 수수료율 서브 테이블.
 * 추가 / 수정 / 삭제를 인라인 다이얼로그로 처리한다.
 */
export function ChannelFeeRatesInline({ channelId }: Props) {
  const [feeRates, setFeeRates] = useState<FeeRate[]>([])
  const [loading, setLoading] = useState(true)

  // 수수료 다이얼로그 상태
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingFee, setEditingFee] = useState<FeeRate | null>(null)
  const [feeCategoryName, setFeeCategoryName] = useState('')
  const [feeRate, setFeeRate] = useState('')
  const [feeVatIncluded, setFeeVatIncluded] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadFeeRates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/channels/${channelId}/fee-rates`)
      if (!res.ok) throw new Error('수수료율 조회 실패')
      const data = await res.json()
      setFeeRates(data.feeRates ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수수료율 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => {
    void loadFeeRates()
  }, [loadFeeRates])

  function openNewFee() {
    setEditingFee(null)
    setFeeCategoryName('')
    setFeeRate('')
    setFeeVatIncluded(false)
    setDialogOpen(true)
  }

  function openEditFee(fee: FeeRate) {
    setEditingFee(fee)
    setFeeCategoryName(fee.categoryName)
    setFeeRate(String(fee.ratePercent))
    setFeeVatIncluded(fee.vatIncluded)
    setDialogOpen(true)
  }

  async function handleSaveFee() {
    if (!feeCategoryName.trim()) {
      toast.error('카테고리명을 입력해 주세요')
      return
    }
    if (!feeRate || isNaN(parseFloat(feeRate))) {
      toast.error('수수료율을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const url = editingFee
        ? `/api/channels/${channelId}/fee-rates/${editingFee.id}`
        : `/api/channels/${channelId}/fee-rates`
      const method = editingFee ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryName: feeCategoryName.trim(),
          ratePercent: parseFloat(feeRate),
          vatIncluded: feeVatIncluded,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editingFee ? '수수료율이 수정되었습니다' : '수수료율이 추가되었습니다')
      setDialogOpen(false)
      await loadFeeRates()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteFee(fee: FeeRate) {
    if (!confirm(`"${fee.categoryName}" 수수료율을 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/channels/${channelId}/fee-rates/${fee.id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('수수료율이 삭제되었습니다')
      await loadFeeRates()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <div className="bg-muted/30 px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">카테고리별 수수료율</p>
        <Button size="sm" variant="outline" onClick={openNewFee}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          수수료 추가
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">불러오는 중...</p>
      ) : feeRates.length === 0 ? (
        <p className="text-xs text-muted-foreground">등록된 수수료율이 없습니다</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-muted">
              <TableHead className="h-8 text-xs">카테고리</TableHead>
              <TableHead className="h-8 text-right text-xs">수수료율 (%)</TableHead>
              <TableHead className="h-8 text-xs">VAT 포함</TableHead>
              <TableHead className="h-8 w-20 text-right text-xs">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {feeRates.map((fee) => (
              <TableRow key={fee.id} className="border-muted">
                <TableCell className="py-2 text-sm font-medium">{fee.categoryName}</TableCell>
                <TableCell className="py-2 text-right text-sm tabular-nums">
                  {fee.ratePercent.toFixed(3)}%
                </TableCell>
                <TableCell className="py-2">
                  {fee.vatIncluded ? (
                    <Badge variant="secondary" className="text-xs">
                      포함
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">미포함</span>
                  )}
                </TableCell>
                <TableCell className="py-2 text-right">
                  <div className="flex items-center justify-end gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEditFee(fee)}
                      aria-label="수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleDeleteFee(fee)}
                      aria-label="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* 수수료 추가/수정 다이얼로그 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingFee ? '수수료율 수정' : '수수료율 추가'}</DialogTitle>
            <DialogDescription>카테고리별 수수료율을 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="fee-cat">카테고리명 *</Label>
              <Input
                id="fee-cat"
                value={feeCategoryName}
                onChange={(e) => setFeeCategoryName(e.target.value)}
                placeholder="예: 패션의류, 생활용품"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fee-rate">수수료율 (%) *</Label>
              <Input
                id="fee-rate"
                type="number"
                min="0"
                max="100"
                step="0.001"
                value={feeRate}
                onChange={(e) => setFeeRate(e.target.value)}
                placeholder="예: 10.8"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="fee-vat">VAT 포함</Label>
                <p className="text-xs text-muted-foreground">수수료율에 부가세 포함 여부</p>
              </div>
              <Switch id="fee-vat" checked={feeVatIncluded} onCheckedChange={setFeeVatIncluded} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              취소
            </Button>
            <Button onClick={handleSaveFee} disabled={saving}>
              {saving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
