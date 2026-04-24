'use client'

/**
 * 배송 등록 페이지 — delivery-mgmt와 동일한 로직, seller-hub URL 기반
 * Phase 2에서 del → sh 컴포넌트 이전 후 이 파일을 정리한다
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, CheckCircle, Trash2, Upload, X } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { RegistrationTable, type OrderRow } from '@/components/sh/shipping/registration-table'
import { BulkPasteDialog } from '@/components/sh/shipping/bulk-paste-dialog'
import { DeliveryFileDialog } from '@/components/sh/shipping/delivery-file-dialog'
import { ProductMatchDialog, type MatchResult } from '@/components/sh/shipping/product-match-dialog'
import { UploadDialog } from '@/components/sh/shipping/upload-dialog'

type ShippingMethod = { id: string; name: string; defaultSplitMode?: 'order' | 'option' }
type Channel = {
  id: string
  name: string
  requireOrderNumber: boolean
  requirePayment: boolean
  requireProducts: boolean
}

export default function ShippingRegistrationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeBatchId, setActiveBatchId] = useState('')
  const [orderCount, setOrderCount] = useState(0)
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [baseDataLoaded, setBaseDataLoaded] = useState(false)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [completing, setCompleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkMemo, setBulkMemo] = useState('')
  const [bulkSelectKey, setBulkSelectKey] = useState(0)
  const [importedCount, setImportedCount] = useState<number | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    description: string
    confirmLabel: string
    destructive?: boolean
    onConfirm: () => void | Promise<void>
  } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [matchTarget, setMatchTarget] = useState<{
    orderId: string
    itemId: string
    rawName: string
    orderQty: number
    channelId: string
    itemIndex: number
  } | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  useEffect(() => {
    const raw = searchParams.get('imported')
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) setImportedCount(n)
      setRefreshKey((k) => k + 1)
      router.replace('/d/seller-hub/shipping/registration')
    }
  }, [searchParams, router])

  const loadBaseData = useCallback(async () => {
    try {
      const [bRes, mRes, cRes] = await Promise.all([
        fetch('/api/sh/shipping/batches?status=DRAFT&pageSize=1'),
        fetch('/api/sh/shipping/shipping-methods?isActive=true'),
        fetch('/api/del/channels?isActive=true'),
      ])
      const bData = await bRes.json()
      const mData = await mRes.json()
      const cData = await cRes.json()
      setShippingMethods(mData.methods ?? [])
      setChannels(cData.channels ?? [])
      setBaseDataLoaded(true)

      if (bData.data?.length > 0) {
        setActiveBatchId(bData.data[0].id)
        setOrderCount(bData.data[0].orderCount ?? 0)
      } else {
        const createRes = await fetch('/api/sh/shipping/batches', {
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

  useEffect(() => {
    setSelectedIds(new Set())
    if (!activeBatchId) {
      setRows([])
      return
    }
    type OrderItemApi = {
      id: string
      name: string
      quantity: number
      optionId: string | null
      listingId: string | null
      option: {
        id: string
        name: string
        product: {
          id: string
          name: string
          internalName: string | null
          displayName: string // 내부 표시용 — 관리명 우선, 없으면 공식명
        } | null
      } | null
      listing: {
        id: string
        searchName: string
        displayName: string
      } | null
      fulfillments: Array<{
        id: string
        optionId: string
        quantity: number
        optionName: string
        productName: string
      }>
    }
    fetch(`/api/sh/shipping/batches/${activeBatchId}/orders?decrypt=true&pageSize=100`)
      .then((r) => r.json())
      .then((data) => {
        if (data.data) {
          const dbRows = data.data.map((order: Record<string, unknown>) => ({
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
            items: ((order.items as OrderItemApi[]) ?? []).map((it) => {
              // matched 표시: 단일 옵션 매칭 또는 listing 매칭
              const matched = it.option?.product
                ? {
                    optionId: it.option.id,
                    productName: it.option.product.displayName,
                    optionName: it.option.name,
                  }
                : it.listing
                  ? {
                      optionId: '',
                      productName: it.listing.searchName,
                      optionName: '판매채널 상품 묶음',
                    }
                  : null
              return {
                itemId: it.id,
                name: it.name,
                quantity: it.quantity,
                optionId: it.optionId,
                listingId: it.listingId,
                matched,
                fulfillments:
                  it.fulfillments && it.fulfillments.length > 0
                    ? it.fulfillments.map((f) => ({
                        optionId: f.optionId,
                        productName: f.productName,
                        optionName: f.optionName,
                        quantity: f.quantity,
                      }))
                    : null,
              }
            }),
            memo: (order.memo as string) ?? '',
          }))
          // 기존 tempId(미저장) 행은 재fetch 시에도 유지 — 파일 업로드 후 수동 입력 행 누적 보존
          setRows((prev) => {
            const tempRows = prev.filter((r) => r.tempId.startsWith('temp-'))
            return [...dbRows, ...tempRows]
          })
        }
      })
      .catch(() => toast.error('주문 로드 실패'))
  }, [activeBatchId, refreshKey])

  type SaveResult = {
    ok: boolean
    // tempId → 저장된 주문의 실제 id + itemId 매핑
    tempToSaved: Map<string, { orderId: string; itemIds: string[] /* name 있는 items 순서 */ }>
  }

  /**
   * 미저장(tempId) 행들을 서버에 저장.
   * - 필수 필드(받는분·전화·주소·주문일자)가 비어 있는 행은 skip하고 나머지만 POST
   * - 성공한 행은 tempId → 실제 orderId로 교체하고 itemId도 반영 (로컬 state 유지)
   * - strict=true (처리 완료) 모드에서는 skip된 행이 있으면 false 반환
   */
  async function saveNewRows(opts: { strict?: boolean } = {}): Promise<SaveResult> {
    const strict = opts.strict ?? false
    const empty: SaveResult = { ok: true, tempToSaved: new Map() }
    const newRows = rows.filter((r) => r.tempId.startsWith('temp-'))
    if (newRows.length === 0) return empty

    const isSavable = (r: (typeof newRows)[number]) =>
      !!(r.recipientName && r.phone && r.address && r.orderDate)
    const savableRows = newRows.filter(isSavable)
    const skippedCount = newRows.length - savableRows.length

    if (strict && skippedCount > 0) {
      toast.error(
        `${skippedCount}건의 주문에 필수 정보가 누락되었습니다 (받는분·전화·주소·주문일자)`
      )
      return { ok: false, tempToSaved: new Map() }
    }
    if (savableRows.length === 0) {
      // 저장 가능한 행이 없어도 에러는 아님 — 실패 시점에서만 처리
      return empty
    }

    const res = await fetch('/api/sh/shipping/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: activeBatchId,
        orders: savableRows.map((r) => ({
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
      return { ok: false, tempToSaved: new Map() }
    }

    // 서버 응답: { orders: [{ index, id, items: [{ id, name, quantity }] }] }
    // index는 savableRows 내 index임.
    const savedOrders = (data.orders ?? []) as Array<{
      index: number
      id: string
      items: Array<{ id: string; name: string; quantity: number }>
    }>
    const tempToSaved = new Map<string, { orderId: string; itemIds: string[] }>()
    for (const s of savedOrders) {
      const savableRow = savableRows[s.index]
      if (savableRow) {
        tempToSaved.set(savableRow.tempId, {
          orderId: s.id,
          itemIds: s.items.map((it) => it.id),
        })
      }
    }

    setRows((prev) =>
      prev.map((r) => {
        const saved = tempToSaved.get(r.tempId)
        if (!saved) return r
        // savableRow의 name 있는 items 순서대로 서버 itemId 매핑
        let savedIdx = 0
        return {
          ...r,
          tempId: saved.orderId,
          items: r.items.map((it) => {
            if (!it.name) return it
            const matchedId = saved.itemIds[savedIdx]
            savedIdx++
            return matchedId ? { ...it, itemId: matchedId } : it
          }),
        }
      })
    )

    return { ok: true, tempToSaved }
  }

  function handleComplete() {
    if (!activeBatchId) return
    setConfirmDialog({
      title: '처리 완료',
      description: '처리 완료하시겠습니까? 완료된 데이터는 배송 데이터 관리에서 조회됩니다.',
      confirmLabel: '완료',
      onConfirm: performComplete,
    })
  }

  async function performComplete() {
    if (!activeBatchId) return
    setCompleting(true)
    try {
      const saveResult = await saveNewRows({ strict: true })
      if (!saveResult.ok) {
        setCompleting(false)
        return
      }
      const res = await fetch(`/api/sh/shipping/batches/${activeBatchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '처리 완료 실패')
      }
      toast.success('배송 묶음이 처리 완료되었습니다')
      setActiveBatchId('')
      setRows([])
      setSelectedIds(new Set())
      setBulkMemo('')
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

  async function handleItemPatch(orderId: string, itemId: string, patch: { quantity: number }) {
    if (orderId.startsWith('temp-')) return // 아직 저장 전이면 로컬만
    try {
      const res = await fetch(`/api/sh/shipping/orders/${orderId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '수량 저장 실패')
      }
      const data = await res.json()
      if (data.noChange || !data.item) return
      // 응답으로 받은 최신 quantity + fulfillments 반영
      setRows((prev) =>
        prev.map((r) =>
          r.tempId === orderId
            ? {
                ...r,
                items: r.items.map((it) =>
                  it.itemId === itemId
                    ? {
                        ...it,
                        quantity: data.item.quantity,
                        fulfillments:
                          Array.isArray(data.item.fulfillments) && data.item.fulfillments.length > 0
                            ? data.item.fulfillments.map(
                                (f: {
                                  optionId: string
                                  productName: string
                                  optionName: string
                                  quantity: number
                                }) => ({
                                  optionId: f.optionId,
                                  productName: f.productName,
                                  optionName: f.optionName,
                                  quantity: f.quantity,
                                })
                              )
                            : null,
                      }
                    : it
                ),
              }
            : r
        )
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수량 저장 실패')
    }
  }

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
      const res = await fetch(`/api/sh/shipping/orders/${tempId}`, { method: 'DELETE' })
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

  async function patchSelectedDbRows(body: Record<string, unknown>): Promise<number> {
    const dbIds = Array.from(selectedIds).filter((id) => !id.startsWith('temp-'))
    if (dbIds.length === 0) return 0
    const results = await Promise.all(
      dbIds.map((id) =>
        fetch(`/api/sh/shipping/orders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.ok)
      )
    )
    return results.filter((ok) => !ok).length
  }

  async function handleBulkShipping(shippingMethodId: string) {
    const count = selectedIds.size
    if (count === 0) return
    const failed = await patchSelectedDbRows({ shippingMethodId })
    setRows((prev) => prev.map((r) => (selectedIds.has(r.tempId) ? { ...r, shippingMethodId } : r)))
    setBulkSelectKey((k) => k + 1)
    setSelectedIds(new Set())
    if (failed > 0) toast.error(`${failed}건 서버 저장 실패`)
    else toast.success(`${count}건 배송방식 변경`)
  }

  async function handleBulkChannel(channelId: string) {
    const count = selectedIds.size
    if (count === 0) return
    const failed = await patchSelectedDbRows({ channelId })
    setRows((prev) => prev.map((r) => (selectedIds.has(r.tempId) ? { ...r, channelId } : r)))
    setBulkSelectKey((k) => k + 1)
    setSelectedIds(new Set())
    if (failed > 0) toast.error(`${failed}건 서버 저장 실패`)
    else toast.success(`${count}건 판매채널 변경`)
  }

  async function handleBulkMemo() {
    const count = selectedIds.size
    if (count === 0) return
    const failed = await patchSelectedDbRows({ memo: bulkMemo })
    setRows((prev) => prev.map((r) => (selectedIds.has(r.tempId) ? { ...r, memo: bulkMemo } : r)))
    setSelectedIds(new Set())
    if (failed > 0) toast.error(`${failed}건 서버 저장 실패`)
    else toast.success(`${count}건 메모 적용`)
    setBulkMemo('')
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setConfirmDialog({
      title: '선택 삭제',
      description: `선택한 ${ids.length}건을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      destructive: true,
      onConfirm: () => performBulkDelete(ids),
    })
  }

  async function performBulkDelete(ids: string[]) {
    const tempIds = ids.filter((id) => id.startsWith('temp-'))
    const dbIds = ids.filter((id) => !id.startsWith('temp-'))
    const deletedDbIds: string[] = []
    await Promise.all(
      dbIds.map(async (id) => {
        try {
          const res = await fetch(`/api/sh/shipping/orders/${id}`, { method: 'DELETE' })
          if (res.ok) deletedDbIds.push(id)
        } catch {
          /* 무시 */
        }
      })
    )
    const removedIds = new Set([...tempIds, ...deletedDbIds])
    setRows((prev) => prev.filter((r) => !removedIds.has(r.tempId)))
    setSelectedIds(new Set())
    setOrderCount((c) => Math.max(0, c - deletedDbIds.length))
    const failedCount = dbIds.length - deletedDbIds.length
    if (failedCount > 0) {
      toast.error(`${failedCount}건 삭제 실패`)
      setRefreshKey((k) => k + 1)
    } else toast.success(`${ids.length}건 삭제 완료`)
  }

  const needsShippingMethodSetup = baseDataLoaded && shippingMethods.length === 0
  const needsChannelSetup = baseDataLoaded && channels.length === 0
  const needsSetup = needsShippingMethodSetup || needsChannelSetup

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
  const actionsDisabled = rows.length === 0 || !allRowsValid || needsSetup
  const actionsDisabledReason = needsSetup
    ? '배송 방식·판매 채널 등록이 필요합니다'
    : rows.length === 0
      ? '등록된 주문이 없습니다'
      : !allRowsValid
        ? '모든 행의 배송방식·판매채널과 필수값을 입력해 주세요'
        : undefined

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">배송 등록</h1>
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
            title={actionsDisabledReason}
          >
            <CheckCircle className="mr-1 h-4 w-4" />
            처리 완료
          </Button>
        </div>
      </div>

      {needsSetup && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>배송 파일 생성·처리 완료 전 셋업이 필요합니다</AlertTitle>
          <AlertDescription>
            <p>
              주문 등록은 가능하지만 아래 항목 등록 전에는 배송 파일 생성과 처리 완료가 제한됩니다.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {needsShippingMethodSetup && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/d/seller-hub/shipping/methods">
                    배송 방식 관리
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              )}
              {needsChannelSetup && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/d/seller-hub/channels">
                    판매 채널 관리
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <span className="text-sm font-medium">배송 묶음</span>
        <Badge variant="secondary">
          {orderCount + rows.filter((r) => r.tempId.startsWith('temp-')).length}건
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <BulkPasteDialog onParsed={handleBulkPaste} />
        <Button
          variant="outline"
          size="sm"
          disabled={!activeBatchId}
          onClick={async () => {
            if (!activeBatchId) return
            // 미저장 수동 행을 먼저 저장 (실패 행은 skip, rows state는 Dialog 열어도 유지됨)
            await saveNewRows()
            setUploadOpen(true)
          }}
        >
          <Upload className="mr-1 h-4 w-4" />
          파일 업로드
        </Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <Badge variant="default">{selectedIds.size}건 선택</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="mr-1 h-3 w-3" />
            선택 해제
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Select key={`ship-${bulkSelectKey}`} onValueChange={handleBulkShipping}>
            <SelectTrigger className="h-8 w-40 bg-background text-xs">
              <SelectValue placeholder="배송방식 변경" />
            </SelectTrigger>
            <SelectContent>
              {shippingMethods.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select key={`chan-${bulkSelectKey}`} onValueChange={handleBulkChannel}>
            <SelectTrigger className="h-8 w-40 bg-background text-xs">
              <SelectValue placeholder="판매채널 변경" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Input
              className="h-8 w-40 bg-background text-xs"
              value={bulkMemo}
              onChange={(e) => setBulkMemo(e.target.value)}
              placeholder="메모 입력"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleBulkMemo()
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 bg-background text-xs"
              onClick={handleBulkMemo}
            >
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
            <Trash2 className="mr-1 h-3 w-3" />
            선택 삭제
          </Button>
        </div>
      )}

      <RegistrationTable
        rows={rows}
        onChange={setRows}
        shippingMethods={shippingMethods}
        channels={channels}
        onRemove={handleRemoveRow}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onItemPatch={handleItemPatch}
        onOpenMatch={async (row, itemIndex) => {
          const item = row.items[itemIndex]
          if (!item) return

          let orderId = row.tempId
          let itemId = item.itemId ?? null

          // 미저장 행이면 먼저 자동 저장 — 반환된 tempToSaved 맵에서 새 id를 바로 사용
          if (!itemId) {
            const saveResult = await saveNewRows()
            if (!saveResult.ok) return
            const saved = saveResult.tempToSaved.get(row.tempId)
            if (!saved) {
              // 필수 필드 누락 등으로 이 행이 저장되지 않음
              toast.error('받는분·전화·주소·주문일자를 먼저 입력해 주세요')
              return
            }
            // savableRow.items에서 name 있는 items 순서로 itemIds가 왔으므로
            // 현재 item이 그 중 몇 번째 '이름 있는' 아이템인지 계산
            const nameIndex = row.items.slice(0, itemIndex + 1).filter((it) => !!it.name).length - 1
            const savedItemId = nameIndex >= 0 ? saved.itemIds[nameIndex] : null
            if (!savedItemId) {
              toast.error('상품명이 비어 있어 저장되지 않았습니다')
              return
            }
            orderId = saved.orderId
            itemId = savedItemId
          }

          setMatchTarget({
            orderId,
            itemId,
            rawName: item.name,
            orderQty: item.quantity,
            channelId: row.channelId,
            itemIndex,
          })
        }}
        onClearMatch={async (row, itemIndex) => {
          const item = row.items[itemIndex]
          if (!item?.itemId) return // 아직 DB에 저장 전이면 매칭이 없음
          try {
            const res = await fetch(
              `/api/sh/shipping/orders/${row.tempId}/items/${item.itemId}/match`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'clear' }),
              }
            )
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              throw new Error(data?.message ?? '매칭 해제 실패')
            }
            setRows((prev) =>
              prev.map((r) =>
                r.tempId !== row.tempId
                  ? r
                  : {
                      ...r,
                      items: r.items.map((it, idx) =>
                        idx !== itemIndex
                          ? it
                          : {
                              ...it,
                              optionId: null,
                              listingId: null,
                              matched: null,
                              fulfillments: null,
                            }
                      ),
                    }
              )
            )
          } catch (err) {
            toast.error(err instanceof Error ? err.message : '매칭 해제 실패')
          }
        }}
      />

      {matchTarget && (
        <ProductMatchDialog
          open={!!matchTarget}
          onOpenChange={(v) => {
            if (!v) setMatchTarget(null)
          }}
          orderId={matchTarget.orderId}
          itemId={matchTarget.itemId}
          rawName={matchTarget.rawName}
          orderQty={matchTarget.orderQty}
          channelId={matchTarget.channelId ?? null}
          channelName={channels.find((c) => c.id === matchTarget.channelId)?.name ?? null}
          channelSet={!!matchTarget.channelId}
          onMatched={(result: MatchResult) => {
            setRows((prev) =>
              prev.map((r) => {
                if (r.tempId !== matchTarget.orderId) return r
                const nextItems = r.items.map((it, idx) => {
                  if (idx !== matchTarget.itemIndex) return it
                  if (result.mode === 'option') {
                    return {
                      ...it,
                      optionId: result.optionId,
                      listingId: null,
                      matched: {
                        optionId: result.optionId,
                        productName: result.productName,
                        optionName: result.optionName,
                      },
                      fulfillments: null,
                    }
                  }
                  if (result.mode === 'listing') {
                    return {
                      ...it,
                      optionId: null,
                      listingId: result.listingId,
                      matched: {
                        optionId: '',
                        productName: result.searchName,
                        optionName: '판매채널 상품 묶음',
                      },
                      // 서버에서 재조회 전이지만 UI에 즉시 반영되도록 비움(상세 로드 시 fulfillments 재수신)
                      fulfillments: null,
                    }
                  }
                  // manual 모드
                  return {
                    ...it,
                    optionId: null,
                    listingId: null,
                    matched: null,
                    fulfillments: result.fulfillments,
                  }
                })
                return { ...r, items: nextItems }
              })
            )
            // 매칭 결과가 fulfillments에 영향을 주는 경우(listing/manual) 서버 재조회로 최신화
            if (result.mode === 'listing' || result.mode === 'manual') {
              setRefreshKey((k) => k + 1)
            }
            setMatchTarget(null)
          }}
        />
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        batchId={activeBatchId}
        onImported={(n) => {
          setImportedCount(n)
          setRefreshKey((k) => k + 1)
        }}
      />

      <Dialog open={importedCount !== null} onOpenChange={(v) => !v && setImportedCount(null)}>
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

      <Dialog
        open={confirmDialog !== null}
        onOpenChange={(v) => {
          if (!v && !confirming) setConfirmDialog(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
            <DialogDescription className="pt-2">{confirmDialog?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={confirming} onClick={() => setConfirmDialog(null)}>
              취소
            </Button>
            <Button
              variant={confirmDialog?.destructive ? 'destructive' : 'default'}
              disabled={confirming}
              onClick={async () => {
                if (!confirmDialog) return
                setConfirming(true)
                try {
                  await confirmDialog.onConfirm()
                } finally {
                  setConfirming(false)
                  setConfirmDialog(null)
                }
              }}
            >
              {confirming ? '처리 중...' : (confirmDialog?.confirmLabel ?? '확인')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
