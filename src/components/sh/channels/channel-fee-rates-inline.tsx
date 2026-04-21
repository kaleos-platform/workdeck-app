'use client'

import { useCallback, useEffect, useState } from 'react'
import { FolderCog, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import { Input } from '@/components/ui/input'
import { ShCategoryManager } from '@/components/sh/products/category-manager'

type FeeRate = {
  id: string
  categoryName: string
  ratePercent: number
  vatIncluded: boolean
}

type ProductCategory = { id: string; name: string }

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

  // 상품 카테고리 목록 (수수료 카테고리명 선택에 활용)
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([])
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)

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

  const loadProductCategories = useCallback(async () => {
    const res = await fetch('/api/sh/categories')
    if (res.ok) {
      const data = await res.json()
      setProductCategories(data.categories ?? [])
    }
  }, [])

  useEffect(() => {
    void loadFeeRates()
    void loadProductCategories()
  }, [loadFeeRates, loadProductCategories])

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
      if (!res.ok) {
        // Zod 에러가 있으면 첫 번째 필드 에러를 같이 표시
        const fieldErrors = data?.errors?.fieldErrors as
          | Record<string, string[] | undefined>
          | undefined
        const firstField = fieldErrors
          ? Object.entries(fieldErrors).find(([, v]) => v && v.length > 0)
          : undefined
        const suffix = firstField ? ` (${firstField[0]}: ${firstField[1]?.[0]})` : ''
        const detail = data?.detail ? `: ${data.detail}` : ''
        throw new Error((data?.message ?? '저장 실패') + suffix + detail)
      }
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
      {/* 상품 카테고리 관리 Dialog (수수료 화면에서 인라인 오픈) */}
      <ShCategoryManager
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        onChanged={() => void loadProductCategories()}
      />
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
              <Label htmlFor="fee-cat">
                카테고리 <span className="text-destructive">*</span>
              </Label>
              {productCategories.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  상품 카테고리를 먼저 만들어주세요.
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="ml-1 h-auto p-0 text-sm"
                    onClick={() => setCategoryManagerOpen(true)}
                  >
                    <FolderCog className="mr-1 h-3.5 w-3.5" />
                    카테고리 관리
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Select
                    value={feeCategoryName || '__none__'}
                    onValueChange={(v) => setFeeCategoryName(v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="카테고리 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {productCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.name}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setCategoryManagerOpen(true)}
                    aria-label="카테고리 관리"
                  >
                    <FolderCog className="h-4 w-4" />
                  </Button>
                </div>
              )}
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
