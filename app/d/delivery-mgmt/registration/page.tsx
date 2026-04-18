'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle, Trash2, Upload, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  RegistrationTable,
  type OrderRow,
} from '@/components/del/registration-table'
import { BulkPasteDialog } from '@/components/del/bulk-paste-dialog'
import { DeliveryFileDialog } from '@/components/del/delivery-file-dialog'

type ShippingMethod = { id: string; name: string }
type Channel = {
  id: string
  name: string
  requireOrderNumber: boolean
  requirePayment: boolean
  requireProducts: boolean
}

export default function DeliveryRegistrationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeBatchId, setActiveBatchId] = useState('')
  const [orderCount, setOrderCount] = useState(0)
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [rows, setRows] = useState<OrderRow[]>([])
  const [completing, setCompleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkMemo, setBulkMemo] = useState('')
  const [bulkSelectKey, setBulkSelectKey] = useState(0)
  const [importedCount, setImportedCount] = useState<number | null>(null)

  // 업로드 페이지 완료 복귀: ?imported=<N> 감지 시 성공 Dialog + 목록 새로고침
  useEffect(() => {
    const raw = searchParams.get('imported')
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) setImportedCount(n)
      setRefreshKey((k) => k + 1)
      router.replace('/d/delivery-mgmt/registration')
    }
  }, [searchParams, router])

  // 기초 데이터 로드 + 단일 DRAFT 배송 묶음 자동 로드/생성
  const loadBaseData = useCallback(async () => {
    try {
      const [bRes, mRes, cRes] = await Promise.all([
        fetch('/api/del/batches?status=DRAFT&pageSize=1'),
        fetch('/api/del/shipping-methods?isActive=true'),
        fetch('/api/del/channels?isActive=true'),
      ])
      const bData = await bRes.json()
      const mData = await mRes.json()
      const cData = await cRes.json()
      setShippingMethods(mData.methods ?? [])
      setChannels(cData.channels ?? [])

      if (bData.data?.length > 0) {
        setActiveBatchId(bData.data[0].id)
        setOrderCount(bData.data[0].orderCount ?? 0)
      } else {
        // DRAFT 없으면 자동 생성
        const createRes = await fetch('/api/del/batches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const createData = await createRes.json()
        if (createRes.ok) {
          setActiveBatchId(createData.batch.id)
          setOrderCount(0)
        }
      }
    } catch {
      toast.error('데이터 로드 실패')
    }
  }, [])

  useEffect(() => {
    loadBaseData()
  }, [loadBaseData, refreshKey])

  // 배송 묶음 선택 시 기존 주문 로드
  useEffect(() => {
    if (!activeBatchId) {
      setRows([])
      return
    }

    fetch(`/api/del/batches/${activeBatchId}/orders?decrypt=true&pageSize=100`)
      .then((r) => r.json())
      .then((data) => {
        if (data.data) {
          setRows(
            data.data.map((order: Record<string, unknown>) => ({
              tempId: order.id as string,
              shippingMethodId: (order.shippingMethod as { id: string })?.id ?? '',
              recipientName: order.recipientName as string,
              phone: order.phone as string,
              address: order.address as string,
              postalCode: (order.postalCode as string) ?? '',
              deliveryMessage: (order.deliveryMessage as string) ?? '',
              orderDate: (order.orderDate as string)?.split('T')[0] ?? '',
              channelId: (order.channel as { id: string } | null)?.id ?? '',
              orderNumber: (order.orderNumber as string) ?? '',
              paymentAmount: order.paymentAmount != null ? String(order.paymentAmount) : '',
              items: (order.items as { name: string; quantity: number }[]) ?? [],
              memo: (order.memo as string) ?? '',
            }))
          )
        }
      })
      .catch(() => toast.error('주문 로드 실패'))
  }, [activeBatchId, refreshKey])

  // 새 주문 저장 (내부 헬퍼)
  async function saveNewRows(): Promise<boolean> {
    const newRows = rows.filter((r) => r.tempId.startsWith('temp-'))
    if (newRows.length === 0) return true

    const invalid = newRows.filter(
      (r) => !r.recipientName || !r.phone || !r.address || !r.shippingMethodId
    )
    if (invalid.length > 0) {
      toast.error(`${invalid.length}건의 주문에 필수 정보가 누락되었습니다`)
      return false
    }

    const res = await fetch('/api/del/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: activeBatchId,
        orders: newRows.map((r) => ({
          shippingMethodId: r.shippingMethodId,
          channelId: r.channelId || null,
          recipientName: r.recipientName,
          phone: r.phone,
          address: r.address,
          postalCode: r.postalCode || null,
          deliveryMessage: r.deliveryMessage || null,
          orderDate: r.orderDate,
          orderNumber: r.orderNumber || null,
          paymentAmount: r.paymentAmount ? Number(r.paymentAmount) : null,
          items: r.items.filter((item) => item.name),
          memo: r.memo || null,
        })),
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data?.message ?? '저장 실패')
      return false
    }
    return true
  }

  // 처리 완료 (저장 + 완료 + 새 DRAFT 자동 생성)
  async function handleComplete() {
    if (!activeBatchId) return
    if (!confirm('처리 완료하시겠습니까? 완료된 데이터는 주문 데이터 관리에서 조회됩니다.')) return

    setCompleting(true)
    try {
      const saved = await saveNewRows()
      if (!saved) {
        setCompleting(false)
        return
      }

      const res = await fetch(`/api/del/batches/${activeBatchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '처리 완료 실패')
      }
      toast.success('배송 묶음이 처리 완료되었습니다')

      // 새 DRAFT 자동 생성
      setActiveBatchId('')
      setRows([])
      setRefreshKey((k) => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리 완료 실패')
    } finally {
      setCompleting(false)
    }
  }

  function handleBulkPaste(pastedRows: OrderRow[]) {
    setRows((prev) => [...prev, ...pastedRows])
  }

  // 행 삭제: 저장된 주문이면 DB에서도 삭제
  async function handleRemoveRow(tempId: string) {
    if (tempId.startsWith('temp-')) {
      setRows((prev) => prev.filter((r) => r.tempId !== tempId))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(tempId)
        return next
      })
      return
    }

    try {
      const res = await fetch(`/api/del/orders/${tempId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '삭제 실패')
      }
      setRows((prev) => prev.filter((r) => r.tempId !== tempId))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(tempId)
        return next
      })
      setOrderCount((c) => Math.max(0, c - 1))
      toast.success('주문이 삭제되었습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  // 선택된 DB 행에 단일 필드 PATCH (PII 없이)
  async function patchSelectedDbRows(body: Record<string, unknown>): Promise<number> {
    const dbIds = Array.from(selectedIds).filter((id) => !id.startsWith('temp-'))
    if (dbIds.length === 0) return 0
    const results = await Promise.all(
      dbIds.map((id) =>
        fetch(`/api/del/orders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.ok),
      ),
    )
    return results.filter((ok) => !ok).length
  }

  // 일괄 배송방식 변경
  async function handleBulkShipping(shippingMethodId: string) {
    const count = selectedIds.size
    if (count === 0) return
    const failed = await patchSelectedDbRows({ shippingMethodId })
    setRows((prev) =>
      prev.map((r) => (selectedIds.has(r.tempId) ? { ...r, shippingMethodId } : r)),
    )
    setBulkSelectKey((k) => k + 1)
    if (failed > 0) toast.error(`${failed}건 서버 저장 실패`)
    else toast.success(`${count}건 배송방식 변경`)
  }

  // 일괄 판매채널 변경
  async function handleBulkChannel(channelId: string) {
    const count = selectedIds.size
    if (count === 0) return
    const failed = await patchSelectedDbRows({ channelId })
    setRows((prev) =>
      prev.map((r) => (selectedIds.has(r.tempId) ? { ...r, channelId } : r)),
    )
    setBulkSelectKey((k) => k + 1)
    if (failed > 0) toast.error(`${failed}건 서버 저장 실패`)
    else toast.success(`${count}건 판매채널 변경`)
  }

  // 일괄 메모 입력
  async function handleBulkMemo() {
    const count = selectedIds.size
    if (count === 0) return
    const failed = await patchSelectedDbRows({ memo: bulkMemo })
    setRows((prev) =>
      prev.map((r) => (selectedIds.has(r.tempId) ? { ...r, memo: bulkMemo } : r)),
    )
    if (failed > 0) toast.error(`${failed}건 서버 저장 실패`)
    else toast.success(`${count}건 메모 적용`)
    setBulkMemo('')
  }

  // 일괄 삭제
  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!confirm(`선택한 ${ids.length}건을 삭제하시겠습니까?`)) return

    const tempIds = ids.filter((id) => id.startsWith('temp-'))
    const dbIds = ids.filter((id) => !id.startsWith('temp-'))

    // DB 행 삭제 — 성공한 ID만 수집
    const deletedDbIds: string[] = []
    await Promise.all(
      dbIds.map(async (id) => {
        try {
          const res = await fetch(`/api/del/orders/${id}`, { method: 'DELETE' })
          if (res.ok) deletedDbIds.push(id)
        } catch {
          // 무시 — 실패 집계에서 확인
        }
      }),
    )

    const removedIds = new Set([...tempIds, ...deletedDbIds])
    setRows((prev) => prev.filter((r) => !removedIds.has(r.tempId)))
    setSelectedIds(new Set())
    setOrderCount((c) => Math.max(0, c - deletedDbIds.length))

    const failedCount = dbIds.length - deletedDbIds.length
    if (failedCount > 0) {
      toast.error(`${failedCount}건 삭제 실패`)
      setRefreshKey((k) => k + 1) // 동기화
    } else {
      toast.success(`${ids.length}건 삭제 완료`)
    }
  }

  // 모든 행의 필수값이 입력되어야 활성화
  const allRowsValid =
    rows.length > 0 &&
    rows.every((r) => {
      if (!r.shippingMethodId || !r.channelId) return false
      if (!r.recipientName || !r.phone || !r.address) return false
      const channel = channels.find((c) => c.id === r.channelId)
      if (!channel) return false
      if (channel.requireOrderNumber && !r.orderNumber) return false
      if (channel.requirePayment && !r.paymentAmount) return false
      if (channel.requireProducts && r.items.filter((i) => i.name).length === 0) return false
      return true
    })
  const actionsDisabled = rows.length === 0 || !allRowsValid

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">배송 등록</h1>
        <div className="flex items-center gap-2">
          <DeliveryFileDialog
            batchId={activeBatchId}
            shippingMethods={shippingMethods}
            disabled={actionsDisabled}
          />
          <Button
            variant="default"
            size="sm"
            onClick={handleComplete}
            disabled={completing || actionsDisabled}
            title={!allRowsValid && rows.length > 0 ? '모든 행의 배송방식과 판매채널을 입력해 주세요' : undefined}
          >
            <CheckCircle className="mr-1 h-4 w-4" />처리 완료
          </Button>
        </div>
      </div>

      {/* 배송 묶음 상태 바 */}
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <span className="text-sm font-medium">배송 묶음</span>
        <Badge variant="secondary">{orderCount + rows.filter((r) => r.tempId.startsWith('temp-')).length}건</Badge>
      </div>

      {/* 입력 도구 바 */}
      <div className="flex items-center gap-2">
        <BulkPasteDialog onParsed={handleBulkPaste} />
        <Button
          asChild
          variant="outline"
          size="sm"
          disabled={!activeBatchId}
          className={!activeBatchId ? 'pointer-events-none opacity-50' : undefined}
        >
          <Link href={`/d/delivery-mgmt/registration/upload?batchId=${activeBatchId}`}>
            <Upload className="mr-1 h-4 w-4" />파일 업로드
          </Link>
        </Button>
      </div>

      {/* 일괄 작업 바 (선택 시 표시) */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <Badge variant="default">{selectedIds.size}건 선택</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="mr-1 h-3 w-3" />선택 해제
          </Button>

          <div className="mx-1 h-5 w-px bg-border" />

          <Select key={`ship-${bulkSelectKey}`} onValueChange={handleBulkShipping}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="배송방식 변경" />
            </SelectTrigger>
            <SelectContent>
              {shippingMethods.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select key={`chan-${bulkSelectKey}`} onValueChange={handleBulkChannel}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="판매채널 변경" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Input
              className="h-8 w-40 text-xs"
              value={bulkMemo}
              onChange={(e) => setBulkMemo(e.target.value)}
              placeholder="메모 입력"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleBulkMemo()
              }}
            />
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleBulkMemo}>
              적용
            </Button>
          </div>

          <div className="mx-1 h-5 w-px bg-border" />

          <Button
            variant="destructive"
            size="sm"
            className="h-8 text-xs"
            onClick={handleBulkDelete}
          >
            <Trash2 className="mr-1 h-3 w-3" />선택 삭제
          </Button>
        </div>
      )}

      {/* 등록 테이블 */}
      <RegistrationTable
        rows={rows}
        onChange={setRows}
        shippingMethods={shippingMethods}
        channels={channels}
        onRemove={handleRemoveRow}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />

      {/* 업로드 성공 Dialog */}
      <Dialog
        open={importedCount !== null}
        onOpenChange={(v) => !v && setImportedCount(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>가져오기 완료</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-center">
            <div className="flex items-center justify-center gap-2">
              <CheckCircle className="h-6 w-6 text-primary" />
              <span className="text-3xl font-semibold">{importedCount}건</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              채널 파일에서 {importedCount}건을 가져왔습니다
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setImportedCount(null)}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
