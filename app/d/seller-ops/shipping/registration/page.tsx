'use client'

/**
 * 배송 등록 페이지 — delivery-mgmt와 동일한 로직, seller-hub URL 기반
 * Phase 2에서 del → sh 컴포넌트 이전 후 이 파일을 정리한다
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  FileDown,
  Loader2,
  MapPin,
  Trash2,
  Upload,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FloatingActionBar,
  floatingActionButtonClass,
  floatingActionButtonDestructiveClass,
  floatingActionInputClass,
  floatingActionSelectTriggerClass,
} from '@/components/ui/floating-action-bar'
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
import type { OrderProduct } from '@/components/sh/shipping/order-product-fields'
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
  requireOrderDate: boolean
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
  const [postalLookupLoading, setPostalLookupLoading] = useState(false)
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
  // 저장된 행 신규 아이템의 itemId 생성 POST 중복 방지: key=`${orderId}:${index}` → Promise<id|null>
  // blur(handleItemNameCommit)와 클릭(onOpenMatch)이 같은 Promise를 공유 → POST 1회
  const inflightItemPost = useRef<Map<string, Promise<string | null>>>(new Map())
  // 기존 itemId의 이름 PATCH inflight — 매칭 후 refetch가 PATCH보다 먼저 도착해 편집이 유실되지 않도록 await 보장.
  // 키별 directed queue: 진행 중 PATCH가 있을 때 새 편집이 들어오면 pending에 최신값을 저장하고,
  // 완료 후 last-sent와 다르면 추가 PATCH를 발행하여 마지막 편집값이 반드시 DB에 반영되게 한다.
  const inflightItemNamePatch = useRef<
    Map<string, { promise: Promise<void>; pending: string | null }>
  >(new Map())
  // 서버가 확정한 마지막 name — pre-edit baseline 비교 및 PATCH 실패 시 롤백 기준값.
  const itemDbName = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const raw = searchParams.get('imported')
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) setImportedCount(n)
      setRefreshKey((k) => k + 1)
      router.replace('/d/seller-ops/shipping/registration')
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
              // 서버가 확정한 마지막 name을 baseline으로 기억 — PATCH 비교/롤백 기준.
              itemDbName.current.set(it.id, it.name)
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
      !!(r.recipientName && r.phone && r.address) && r.items.some((i) => i.name && i.quantity >= 1)
    const savableRows = newRows.filter(isSavable)
    const skippedCount = newRows.length - savableRows.length

    if (strict && skippedCount > 0) {
      toast.error(`${skippedCount}건의 주문에 필수 정보가 누락되었습니다`)
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
          orderDate: r.orderDate || null,
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

  async function handleRowPatch(orderId: string, patch: Record<string, unknown>) {
    if (orderId.startsWith('temp-')) return
    try {
      const res = await fetch(`/api/sh/shipping/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { message?: string })?.message ?? '저장 실패')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
      setRefreshKey((k) => k + 1)
    }
  }

  // 우편번호 자동조회 — 주소가 있고 우편번호가 빈 행을 카카오 API로 일괄 조회.
  async function handlePostalLookup() {
    const targets = rows
      .filter((r) => !r.postalCode.trim() && r.address.trim())
      .map((r) => ({ id: r.tempId, address: r.address }))
    if (targets.length === 0) {
      toast.info('조회할 행이 없습니다 (주소가 있고 우편번호가 빈 행 대상)')
      return
    }
    setPostalLookupLoading(true)
    try {
      const res = await fetch('/api/sh/shipping/postal-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: targets }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { message?: string })?.message ?? '우편번호 조회 실패')
      }
      const { results, rateLimited } = (await res.json()) as {
        results: { id: string; postalCode: string | null }[]
        rateLimited?: boolean
      }
      const found = new Map(
        results.filter((r) => r.postalCode).map((r) => [r.id, r.postalCode as string])
      )
      if (found.size > 0) {
        // 로컬 갱신 (임시행은 저장 시 saveNewRows POST body에 postalCode 포함)
        setRows((prev) =>
          prev.map((r) =>
            found.has(r.tempId) ? { ...r, postalCode: found.get(r.tempId) as string } : r
          )
        )
        // 저장된 행은 즉시 PATCH
        await Promise.allSettled(
          [...found.entries()]
            .filter(([id]) => !id.startsWith('temp-'))
            .map(([id, postalCode]) => handleRowPatch(id, { postalCode }))
        )
      }
      const failCount = targets.length - found.size
      if (found.size === 0) {
        toast.warning('우편번호를 조회하지 못했습니다')
      } else if (failCount > 0) {
        toast.warning(`${found.size}건 조회 완료, ${failCount}건 실패`)
      } else {
        toast.success(`${found.size}건 우편번호 조회 완료`)
      }
      if (rateLimited) {
        toast.error('카카오 API 호출 한도 초과 — 잠시 후 다시 시도하세요')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '우편번호 조회 실패')
    } finally {
      setPostalLookupLoading(false)
    }
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

  // 상품 입력필드 추가 — 저장 전·후 모두 로컬 빈 행 push.
  // 저장된 행에서 이름이 입력되어 blur되면 handleItemNameCommit이 POST 호출.
  function handleItemAdd(rowTempId: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.tempId === rowTempId ? { ...r, items: [...r.items, { name: '', quantity: 1 }] } : r
      )
    )
  }

  // 상품 입력필드 삭제 — 저장된 아이템(itemId 있음)이면 DELETE API 호출.
  async function handleItemRemove(rowTempId: string, index: number, item: OrderProduct) {
    const isSaved = !rowTempId.startsWith('temp-')
    if (isSaved && item.itemId) {
      try {
        const res = await fetch(`/api/sh/shipping/orders/${rowTempId}/items/${item.itemId}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.message ?? '상품 삭제 실패')
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '상품 삭제 실패')
        return
      }
    }
    setRows((prev) =>
      prev.map((r) =>
        r.tempId === rowTempId ? { ...r, items: r.items.filter((_, i) => i !== index) } : r
      )
    )
  }

  /**
   * 저장된 행의 신규 아이템(itemId 미부여)을 DB에 생성하고 itemId를 반환한다.
   * blur(handleItemNameCommit)와 매칭 클릭(onOpenMatch)이 동시에 호출해도
   * key별 in-flight Promise를 공유해 POST가 1회만 발생한다.
   * 반환: 생성/기존 itemId, 또는 가드 미충족·실패 시 null.
   */
  async function ensureSavedItemId(
    rowTempId: string,
    index: number,
    name: string,
    item: OrderProduct
  ): Promise<string | null> {
    if (rowTempId.startsWith('temp-')) return null // 미저장 행은 saveNewRows 경로
    if (item.itemId) return item.itemId
    const trimmed = name.trim()
    if (!trimmed) return null

    const key = `${rowTempId}:${index}`
    const existing = inflightItemPost.current.get(key)
    if (existing) return existing

    const promise = (async (): Promise<string | null> => {
      try {
        const res = await fetch(`/api/sh/shipping/orders/${rowTempId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed, quantity: item.quantity ?? 1 }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.message ?? '상품 추가 실패')
        }
        const data = await res.json()
        const newId = data?.item?.id as string | undefined
        if (!newId) return null
        // baseline 등록 — 새로 생성된 아이템의 DB 확정 이름.
        itemDbName.current.set(newId, trimmed)
        // POST 진행 중 다른 아이템 추가/삭제로 index가 밀릴 수 있으므로
        // array index 대신 "itemId 없고 이름이 일치하는 아이템"으로 식별해 반영.
        setRows((prev) =>
          prev.map((r) => {
            if (r.tempId !== rowTempId) return r
            let applied = false
            return {
              ...r,
              items: r.items.map((it) => {
                if (applied || it.itemId || it.name.trim() !== trimmed) return it
                applied = true
                return { ...it, itemId: newId }
              }),
            }
          })
        )
        return newId
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '상품 추가 실패')
        return null
      } finally {
        inflightItemPost.current.delete(key)
      }
    })()

    inflightItemPost.current.set(key, promise)
    return promise
  }

  // 아이템 이름 blur 시 — DB에 영속.
  //  - 미저장 행(temp-)은 saveNewRows 경로에서 처리 → no-op
  //  - 저장된 행 + itemId 없음 → POST로 DB에 생성 (ensureSavedItemId)
  //  - 저장된 행 + itemId 있음 → 마지막 DB 확정값(baseline)과 다르면 PATCH (last-write-wins 큐)
  async function handleItemNameCommit(
    rowTempId: string,
    index: number,
    name: string,
    item: OrderProduct
  ) {
    if (rowTempId.startsWith('temp-')) return
    if (!item.itemId) {
      await ensureSavedItemId(rowTempId, index, name, item)
      return
    }
    const itemId = item.itemId
    const trimmed = name.trim()
    if (!trimmed) return
    const baseline = itemDbName.current.get(itemId) ?? item.name
    if (trimmed === baseline.trim()) return

    const key = `${rowTempId}:${itemId}`
    const slot = inflightItemNamePatch.current.get(key)
    if (slot) {
      // 진행 중 PATCH가 있으면 최신 값을 pending에 저장 — 완료 후 자동 재발행됨.
      slot.pending = trimmed
      return
    }

    const runPatch = async (target: string): Promise<void> => {
      try {
        const res = await fetch(`/api/sh/shipping/orders/${rowTempId}/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: target }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.message ?? '상품명 저장 실패')
        }
        const data = await res.json().catch(() => ({}))
        const echoed = (data?.item?.name as string | undefined) ?? target
        itemDbName.current.set(itemId, echoed)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '상품명 저장 실패')
        // 실패 시 UI 롤백 — 마지막 DB 확정값으로 복원.
        const restore = itemDbName.current.get(itemId)
        if (restore !== undefined) {
          setRows((prev) =>
            prev.map((r) => {
              if (r.tempId !== rowTempId) return r
              return {
                ...r,
                items: r.items.map((p) => (p.itemId === itemId ? { ...p, name: restore } : p)),
              }
            })
          )
        }
        throw err
      }
    }

    const promise = (async () => {
      let target = trimmed
      // last-write-wins: 발행 후 pending이 추가됐으면 다시 발행.
      while (true) {
        try {
          await runPatch(target)
        } catch {
          // 실패는 toast로 알림. 큐는 비우고 종료.
          break
        }
        const current = inflightItemNamePatch.current.get(key)
        const next = current?.pending ?? null
        if (next === null || next === target) break
        target = next
        if (current) current.pending = null
      }
    })()

    inflightItemNamePatch.current.set(key, { promise, pending: null })
    try {
      await promise
    } finally {
      inflightItemNamePatch.current.delete(key)
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

  // 선택 주문만 배송 파일 생성 — 저장된(DB) 주문만 가능. 미저장 행은 제외 안내.
  async function handleBulkGenerateFile() {
    if (!activeBatchId) return
    const ids = Array.from(selectedIds)
    const dbIds = ids.filter((id) => !id.startsWith('temp-'))
    const tempCount = ids.length - dbIds.length
    if (dbIds.length === 0) {
      toast.error(
        '저장된 주문만 배송 파일로 만들 수 있습니다. 먼저 처리 완료 또는 업로드로 저장하세요'
      )
      return
    }
    if (tempCount > 0) {
      toast.warning(`미저장 ${tempCount}건은 제외하고 ${dbIds.length}건만 생성합니다`)
    }
    try {
      const res = await fetch('/api/sh/shipping/generate-file/bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: activeBatchId, selectedOrderIds: dbIds }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || data?.message || '배송 파일 생성 실패')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const m = disposition.match(/filename="?([^"]+)"?/)
      const filename = m ? decodeURIComponent(m[1]) : '배송파일'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`선택 ${dbIds.length}건 배송 파일이 다운로드되었습니다`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '배송 파일 생성 실패')
    }
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

  // 상품 옵션 매칭 여부 — 이름이 있는 아이템은 단일 옵션·판매채널 listing·수동 fulfillment 중 하나로 매칭되어야 한다.
  // 매칭되지 않으면 배송 파일에 옵션 식별 정보가 누락되므로 파일 생성·처리 완료를 차단한다.
  const isItemMatched = (item: OrderProduct) =>
    !!item.optionId || !!item.listingId || (item.fulfillments?.length ?? 0) > 0
  const hasUnmatchedItems = rows.some((r) => r.items.some((it) => it.name && !isItemMatched(it)))

  const allRowsValid =
    rows.length > 0 &&
    rows.every((r) => {
      if (!r.shippingMethodId || !r.channelId) return false
      if (!r.recipientName || !r.phone || !r.address) return false
      const validItems = r.items.filter((i) => i.name && i.quantity >= 1)
      if (validItems.length === 0) return false
      const channel = channels.find((c) => c.id === r.channelId)
      if (!channel) return false
      if (channel.requireOrderNumber && !r.orderNumber) return false
      if (channel.requirePayment && !r.paymentAmount) return false
      if (channel.requireOrderDate && !r.orderDate) return false
      return true
    })
  const actionsDisabled = rows.length === 0 || !allRowsValid || hasUnmatchedItems || needsSetup
  const actionsDisabledReason = needsSetup
    ? '배송 방식·판매 채널 등록이 필요합니다'
    : rows.length === 0
      ? '등록된 주문이 없습니다'
      : !allRowsValid
        ? '모든 행의 배송방식·판매채널과 필수값을 입력해 주세요'
        : hasUnmatchedItems
          ? '매칭되지 않은 상품이 있습니다 — 상품 매칭을 완료해 주세요'
          : undefined

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">배송 등록</h1>
        <div className="flex items-center gap-2">
          <DeliveryFileDialog
            batchId={activeBatchId}
            disabled={actionsDisabled}
            onGenerated={handleComplete}
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
                  <Link href="/d/seller-ops/shipping/methods">
                    배송 방식 관리
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              )}
              {needsChannelSetup && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/d/seller-ops/channels">
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
        <Button
          variant="outline"
          size="sm"
          disabled={postalLookupLoading}
          onClick={handlePostalLookup}
        >
          {postalLookupLoading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <MapPin className="mr-1 h-4 w-4" />
          )}
          우편번호 자동조회
        </Button>
      </div>

      <FloatingActionBar
        open={selectedIds.size > 0}
        onClear={() => setSelectedIds(new Set())}
        actions={
          <>
            <Select key={`ship-${bulkSelectKey}`} onValueChange={handleBulkShipping}>
              <SelectTrigger className={`${floatingActionSelectTriggerClass} w-40 text-xs`}>
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
              <SelectTrigger className={`${floatingActionSelectTriggerClass} w-40 text-xs`}>
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
            <Input
              className={`${floatingActionInputClass} w-40 text-xs`}
              value={bulkMemo}
              onChange={(e) => setBulkMemo(e.target.value)}
              placeholder="메모 입력"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleBulkMemo()
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonClass}
              onClick={handleBulkMemo}
            >
              적용
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonClass}
              onClick={handleBulkGenerateFile}
            >
              <FileDown className="mr-1 h-3.5 w-3.5" />
              선택 배송파일
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonDestructiveClass}
              onClick={handleBulkDelete}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              선택 삭제
            </Button>
          </>
        }
      >
        <span className="text-sm font-semibold">{selectedIds.size}건 선택</span>
      </FloatingActionBar>

      <RegistrationTable
        rows={rows}
        onChange={setRows}
        shippingMethods={shippingMethods}
        channels={channels}
        onRemove={handleRemoveRow}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onItemPatch={handleItemPatch}
        onRowPatch={handleRowPatch}
        onItemAdd={handleItemAdd}
        onItemRemove={handleItemRemove}
        onItemNameCommit={handleItemNameCommit}
        onOpenMatch={async (row, itemIndex) => {
          const item = row.items[itemIndex]
          if (!item) return

          let orderId = row.tempId
          let itemId = item.itemId ?? null

          if (!itemId) {
            const isSavedRow = !row.tempId.startsWith('temp-')
            if (isSavedRow) {
              // 저장된 행의 신규 아이템: blur POST와 동일/공유 Promise로 itemId 확보
              if (!item.name?.trim()) {
                toast.error('상품명을 먼저 입력해 주세요')
                return
              }
              const newItemId = await ensureSavedItemId(row.tempId, itemIndex, item.name, item)
              if (!newItemId) return // 네트워크 오류 등 — ensure가 이미 toast
              orderId = row.tempId
              itemId = newItemId
            } else {
              // 미저장 temp- 행이면 먼저 자동 저장 — tempToSaved 맵에서 새 id를 사용
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
              const nameIndex =
                row.items.slice(0, itemIndex + 1).filter((it) => !!it.name).length - 1
              const savedItemId = nameIndex >= 0 ? saved.itemIds[nameIndex] : null
              if (!savedItemId) {
                toast.error('상품명이 비어 있어 저장되지 않았습니다')
                return
              }
              orderId = saved.orderId
              itemId = savedItemId
            }
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
          onMatched={async (result: MatchResult) => {
            // 진행 중인 name PATCH가 있으면 refetch 전에 완료 — 편집한 상품명이 서버 응답에 반영되도록.
            const pending = Array.from(inflightItemNamePatch.current.values()).map((s) => s.promise)
            if (pending.length > 0) {
              await Promise.all(pending)
            }
            setRows((prev) =>
              prev.map((r) => {
                if (r.tempId !== matchTarget.orderId) return r
                const nextItems = r.items.map((it, idx) => {
                  if (idx !== matchTarget.itemIndex) return it
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
