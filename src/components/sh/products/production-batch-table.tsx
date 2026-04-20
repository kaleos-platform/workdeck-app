'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type OptionSummary = {
  id: string
  name: string
}

type BatchRow = {
  id: string
  batchNo: string
  producedAt: string | null
  unitCost: number
  quantity: number | null
  memo: string | null
  option: OptionSummary
}

type Props = {
  productId: string
}

export function ProductionBatchTable({ productId }: Props) {
  const [options, setOptions] = useState<OptionSummary[]>([])
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOptionId, setSelectedOptionId] = useState<string>('all')

  // 다이얼로그 상태
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftOptionId, setDraftOptionId] = useState('')
  const [draftBatchNo, setDraftBatchNo] = useState('')
  const [draftProducedAt, setDraftProducedAt] = useState('')
  const [draftUnitCost, setDraftUnitCost] = useState('')
  const [draftQuantity, setDraftQuantity] = useState('')
  const [draftMemo, setDraftMemo] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // 옵션 목록과 배치 데이터를 상품 상세 API에서 한 번에 가져옴
      const [optRes, prodRes] = await Promise.all([
        fetch(`/api/sh/products/${productId}/options`),
        fetch(`/api/sh/products/${productId}`),
      ])

      if (optRes.ok) {
        const optData = await optRes.json()
        const opts: OptionSummary[] = (optData.options ?? optData ?? []).map(
          (o: { id: string; name: string }) => ({ id: o.id, name: o.name })
        )
        setOptions(opts)
        // 첫 로드 시 첫 번째 옵션을 다이얼로그 기본값으로 설정
        if (opts.length > 0) {
          setDraftOptionId((prev) => prev || opts[0].id)
        }
      }

      if (!prodRes.ok) return
      const prodData = await prodRes.json()
      const allBatches: BatchRow[] = []
      ;(prodData.options ?? []).forEach(
        (opt: { id: string; name: string; batches?: BatchRow[] }) => {
          ;(opt.batches ?? []).forEach((b) => {
            allBatches.push({ ...b, option: { id: opt.id, name: opt.name } })
          })
        }
      )
      setBatches(allBatches)
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function openNew() {
    setDraftOptionId(options[0]?.id ?? '')
    setDraftBatchNo('')
    setDraftProducedAt('')
    setDraftUnitCost('')
    setDraftQuantity('')
    setDraftMemo('')
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!draftOptionId) {
      toast.error('옵션을 선택해 주세요')
      return
    }
    if (!draftBatchNo.trim()) {
      toast.error('차수 번호를 입력해 주세요')
      return
    }
    if (!draftUnitCost || isNaN(parseFloat(draftUnitCost))) {
      toast.error('생산 단가를 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}/options/${draftOptionId}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchNo: draftBatchNo.trim(),
          producedAt: draftProducedAt || null,
          unitCost: parseFloat(draftUnitCost),
          quantity: draftQuantity ? parseInt(draftQuantity, 10) : null,
          memo: draftMemo.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success('생산 차수가 추가되었습니다')
      setDialogOpen(false)
      // 데이터 재로드
      const optRes = await fetch(`/api/sh/products/${productId}`)
      if (optRes.ok) {
        const prodData = await optRes.json()
        const allBatches: BatchRow[] = []
        ;(prodData.options ?? []).forEach(
          (opt: { id: string; name: string; batches?: BatchRow[] }) => {
            ;(opt.batches ?? []).forEach((b) => {
              allBatches.push({ ...b, option: { id: opt.id, name: opt.name } })
            })
          }
        )
        setBatches(allBatches)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const filteredBatches =
    selectedOptionId === 'all' ? batches : batches.filter((b) => b.option.id === selectedOptionId)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">생산 차수</h3>
          <Select value={selectedOptionId} onValueChange={setSelectedOptionId}>
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue placeholder="전체 옵션" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 옵션</SelectItem>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={openNew} disabled={options.length === 0}>
          <Plus className="mr-1 h-3 w-3" />
          차수 추가
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>옵션</TableHead>
              <TableHead>차수 번호</TableHead>
              <TableHead>생산일</TableHead>
              <TableHead className="text-right">단가</TableHead>
              <TableHead className="text-right">수량</TableHead>
              <TableHead>메모</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : filteredBatches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  등록된 생산 차수가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              filteredBatches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="text-sm">{batch.option.name}</TableCell>
                  <TableCell className="font-mono text-sm">{batch.batchNo}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {batch.producedAt
                      ? new Date(batch.producedAt).toLocaleDateString('ko-KR')
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {new Intl.NumberFormat('ko-KR', {
                      style: 'currency',
                      currency: 'KRW',
                      maximumFractionDigits: 0,
                    }).format(batch.unitCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {batch.quantity?.toLocaleString('ko-KR') ?? '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {batch.memo ?? '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>생산 차수 추가</DialogTitle>
            <DialogDescription>옵션별 생산 차수 정보를 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>옵션 *</Label>
              <Select value={draftOptionId} onValueChange={setDraftOptionId}>
                <SelectTrigger>
                  <SelectValue placeholder="옵션 선택" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="batch-no">차수 번호 *</Label>
                <Input
                  id="batch-no"
                  value={draftBatchNo}
                  onChange={(e) => setDraftBatchNo(e.target.value)}
                  placeholder="예: 2024-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="produced-at">생산일</Label>
                <Input
                  id="produced-at"
                  type="date"
                  value={draftProducedAt}
                  onChange={(e) => setDraftProducedAt(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="unit-cost">생산 단가 (원) *</Label>
                <Input
                  id="unit-cost"
                  type="number"
                  min="0"
                  value={draftUnitCost}
                  onChange={(e) => setDraftUnitCost(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quantity">수량</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="0"
                  value={draftQuantity}
                  onChange={(e) => setDraftQuantity(e.target.value)}
                  placeholder="(선택)"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-memo">메모</Label>
              <Textarea
                id="batch-memo"
                value={draftMemo}
                onChange={(e) => setDraftMemo(e.target.value)}
                placeholder="메모 (선택)"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '추가'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
