'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  RegistrationTable,
  type OrderRow,
} from '@/components/del/registration-table'
import { BulkPasteDialog } from '@/components/del/bulk-paste-dialog'
import { ChannelUploadDialog } from '@/components/del/channel-upload-dialog'
import { DeliveryFileDialog } from '@/components/del/delivery-file-dialog'

type Batch = {
  id: string
  status: string
  label: string | null
  orderCount: number
  createdAt: string
}

type ShippingMethod = { id: string; name: string }
type Channel = {
  id: string
  name: string
  requireOrderNumber: boolean
  requirePayment: boolean
  requireProducts: boolean
}

const NO_BATCH = '__none__'

export default function DeliveryRegistrationPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [activeBatchId, setActiveBatchId] = useState('')
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [rows, setRows] = useState<OrderRow[]>([])
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // 기초 데이터 로드
  const loadBaseData = useCallback(async () => {
    try {
      const [bRes, mRes, cRes] = await Promise.all([
        fetch('/api/del/batches?status=DRAFT'),
        fetch('/api/del/shipping-methods?isActive=true'),
        fetch('/api/del/channels?isActive=true'),
      ])
      const bData = await bRes.json()
      const mData = await mRes.json()
      const cData = await cRes.json()
      setBatches(bData.data ?? [])
      setShippingMethods(mData.methods ?? [])
      setChannels(cData.channels ?? [])

      // 첫 번째 DRAFT 배치 자동 선택
      if (bData.data?.length > 0 && !activeBatchId) {
        setActiveBatchId(bData.data[0].id)
      }
    } catch {
      toast.error('데이터 로드 실패')
    }
  }, [activeBatchId])

  useEffect(() => {
    loadBaseData()
  }, [loadBaseData, refreshKey])

  // 배치 선택 시 기존 주문 로드
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
            }))
          )
        }
      })
      .catch(() => toast.error('주문 로드 실패'))
  }, [activeBatchId, refreshKey])

  // 새 배치 생성
  async function handleCreateBatch() {
    try {
      const res = await fetch('/api/del/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '생성 실패')
      setActiveBatchId(data.batch.id)
      setRefreshKey((k) => k + 1)
      toast.success('새 배치가 생성되었습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '배치 생성 실패')
    }
  }

  // 주문 저장 (새 행 = POST, 기존 행은 이미 DB에 있음)
  async function handleSaveOrders() {
    if (!activeBatchId) {
      toast.error('배치를 선택해 주세요')
      return
    }

    // 새로 추가된 행만 저장 (tempId가 temp-로 시작하는 것)
    const newRows = rows.filter((r) => r.tempId.startsWith('temp-'))
    if (newRows.length === 0) {
      toast.info('저장할 새 주문이 없습니다')
      return
    }

    // 유효성 검증
    const invalid = newRows.filter(
      (r) => !r.recipientName || !r.phone || !r.address || !r.shippingMethodId
    )
    if (invalid.length > 0) {
      toast.error(`${invalid.length}건의 주문에 필수 정보가 누락되었습니다`)
      return
    }

    setSaving(true)
    try {
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
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(`${data.created}건 저장 완료`)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // 처리 완료
  async function handleComplete() {
    if (!activeBatchId) return
    if (!confirm('처리 완료하시겠습니까? 완료된 데이터는 주문 데이터 관리에서 조회됩니다.')) return

    // 먼저 저장되지 않은 행이 있으면 저장
    const newRows = rows.filter((r) => r.tempId.startsWith('temp-'))
    if (newRows.length > 0) {
      toast.error('저장되지 않은 주문이 있습니다. 먼저 저장해 주세요.')
      return
    }

    setCompleting(true)
    try {
      const res = await fetch(`/api/del/batches/${activeBatchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '처리 완료 실패')
      }
      toast.success('배치가 처리 완료되었습니다')
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

  const activeBatch = batches.find((b) => b.id === activeBatchId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">배송 등록</h1>
        <div className="flex items-center gap-2">
          {activeBatchId && (
            <>
              <DeliveryFileDialog
                batchId={activeBatchId}
                shippingMethods={shippingMethods}
              />
              <Button
                variant="default"
                size="sm"
                onClick={handleComplete}
                disabled={completing || rows.length === 0}
              >
                <CheckCircle className="mr-1 h-4 w-4" />처리 완료
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 배치 선택/생성 바 */}
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <span className="text-sm font-medium">배치:</span>
        <Select
          value={activeBatchId || NO_BATCH}
          onValueChange={(v) => setActiveBatchId(v === NO_BATCH ? '' : v)}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="배치 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_BATCH}>배치 선택</SelectItem>
            {batches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.label || new Date(b.createdAt).toLocaleDateString('ko-KR')}{' '}
                ({b.orderCount}건)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleCreateBatch}>
          <Plus className="mr-1 h-4 w-4" />새 배치
        </Button>

        {activeBatch && (
          <Badge variant="secondary">{activeBatch.orderCount}건 등록됨</Badge>
        )}
      </div>

      {/* 입력 도구 바 */}
      {activeBatchId && (
        <div className="flex items-center gap-2">
          <BulkPasteDialog onParsed={handleBulkPaste} />
          <ChannelUploadDialog
            batchId={activeBatchId}
            shippingMethodId={shippingMethods[0]?.id ?? ''}
            channelId=""
            onImported={() => setRefreshKey((k) => k + 1)}
          />
          <div className="flex-1" />
          <Button onClick={handleSaveOrders} disabled={saving}>
            {saving ? '저장 중...' : '주문 저장'}
          </Button>
        </div>
      )}

      {/* 등록 테이블 */}
      {activeBatchId ? (
        <RegistrationTable
          rows={rows}
          onChange={setRows}
          shippingMethods={shippingMethods}
          channels={channels}
        />
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed py-16">
          <p className="text-muted-foreground">배치를 선택하거나 새로 생성해 주세요</p>
        </div>
      )}
    </div>
  )
}
