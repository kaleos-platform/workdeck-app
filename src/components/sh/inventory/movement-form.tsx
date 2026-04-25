'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Loader2, Plus } from 'lucide-react'

type MovementType = 'INBOUND' | 'OUTBOUND' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT'

type LocationItem = { id: string; name: string; isActive: boolean }
type ChannelItem = { id: string; name: string; isActive: boolean }
type ProductItem = { id: string; name: string; code: string | null; optionsCount: number }
type OptionItem = { id: string; name: string; sku: string | null; totalStock: number }

type OptionEntry = {
  optionId: string
  optionName: string
  sku: string | null
  totalStock: number
  selected: boolean
  quantity: string
}

type Props = {
  onCreated?: () => void
}

const TYPE_OPTIONS: { value: MovementType; label: string }[] = [
  { value: 'INBOUND', label: '입고' },
  { value: 'OUTBOUND', label: '출고' },
  { value: 'RETURN', label: '반품' },
  { value: 'TRANSFER', label: '이동' },
  { value: 'ADJUSTMENT', label: '조정' },
]

const DATE_LABEL: Record<MovementType, string> = {
  INBOUND: '입고 날짜',
  OUTBOUND: '출고 날짜',
  RETURN: '반품 날짜',
  TRANSFER: '이동 날짜',
  ADJUSTMENT: '조정 날짜',
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export function MovementForm({ onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [movementType, setMovementType] = useState<MovementType>('INBOUND')

  // Common fields
  const [productId, setProductId] = useState<string>('')
  const [optionEntries, setOptionEntries] = useState<OptionEntry[]>([])
  const [locationId, setLocationId] = useState<string>('')
  const [toLocationId, setToLocationId] = useState<string>('')
  const [movementDate, setMovementDate] = useState<string>(todayStr())
  const [orderDate, setOrderDate] = useState<string>(todayStr())
  const [channelId, setChannelId] = useState<string>('')
  const [reason, setReason] = useState<string>('')
  const [referenceId, setReferenceId] = useState<string>('')

  // Lookups
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [channels, setChannels] = useState<ChannelItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)

  // New channel inline create
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')

  const resetForm = useCallback(() => {
    setMovementType('INBOUND')
    setProductId('')
    setOptionEntries([])
    setLocationId('')
    setToLocationId('')
    setMovementDate(todayStr())
    setOrderDate(todayStr())
    setChannelId('')
    setReason('')
    setReferenceId('')
    setCreatingChannel(false)
    setNewChannelName('')
  }, [])

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/sh/inventory/products?pageSize=500')
      if (res.ok) {
        const j = await res.json()
        setProducts(j.data ?? [])
      }
    } catch {
      // ignore
    }
  }, [])

  // Fetch lookups when dialog opens
  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const [locRes, chRes] = await Promise.all([
          fetch('/api/sh/inventory/locations?isActive=true'),
          fetch('/api/inv/channels?isActive=true'),
        ])
        if (locRes.ok) {
          const j = await locRes.json()
          setLocations(j.locations ?? [])
        }
        if (chRes.ok) {
          const j = await chRes.json()
          setChannels(j.channels ?? [])
        }
        await loadProducts()
      } catch {
        toast.error('초기 데이터를 불러오지 못했습니다')
      }
    })()
  }, [open, loadProducts])

  // 새 탭에서 상품 등록 후 돌아오면 products 자동 새로고침
  useEffect(() => {
    if (!open) return
    const onFocus = () => {
      void loadProducts()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [open, loadProducts])

  // When product changes, fetch its options
  useEffect(() => {
    if (!productId) {
      setOptionEntries([])
      return
    }
    let cancelled = false
    setLoadingOptions(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/sh/inventory/products/${productId}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (cancelled) return
        const opts: OptionItem[] = data.options ?? []
        setOptionEntries(
          opts.map((o) => ({
            optionId: o.id,
            optionName: o.name,
            sku: o.sku,
            totalStock: o.totalStock,
            selected: false,
            quantity: '',
          }))
        )
      } catch {
        if (!cancelled) {
          setOptionEntries([])
          toast.error('옵션 정보를 불러오지 못했습니다')
        }
      } finally {
        if (!cancelled) setLoadingOptions(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [productId])

  function updateEntry(optionId: string, patch: Partial<OptionEntry>) {
    setOptionEntries((prev) => prev.map((e) => (e.optionId === optionId ? { ...e, ...patch } : e)))
  }

  function toggleAll(selected: boolean) {
    setOptionEntries((prev) => prev.map((e) => ({ ...e, selected })))
  }

  async function handleCreateChannel() {
    const name = newChannelName.trim()
    if (!name) return
    try {
      const res = await fetch('/api/inv/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? '채널 생성 실패')
      const created: ChannelItem = data.channel
      setChannels((prev) => [...prev, created])
      setChannelId(created.id)
      setCreatingChannel(false)
      setNewChannelName('')
      toast.success(`채널 "${created.name}" 생성 완료`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '채널 생성 실패')
    }
  }

  function selectedTargets(): Array<{ optionId: string; quantity: number }> {
    return optionEntries
      .filter((e) => e.selected)
      .map((e) => ({ optionId: e.optionId, quantity: Number(e.quantity) }))
  }

  function validate(): string | null {
    if (!movementDate) return '날짜를 입력하세요'
    if (!locationId) return '위치를 선택하세요'
    if (!productId) return '상품을 선택하세요'

    const targets = optionEntries.filter((e) => e.selected)
    if (targets.length === 0) return '옵션을 1개 이상 선택하세요'

    for (const t of targets) {
      const qty = Number(t.quantity)
      if (!Number.isFinite(qty)) return `"${t.optionName}" 수량을 입력하세요`
      if (movementType !== 'ADJUSTMENT' && qty <= 0)
        return `"${t.optionName}" 수량은 1 이상이어야 합니다`
      if (movementType === 'ADJUSTMENT' && qty < 0)
        return `"${t.optionName}" 실물 수량은 0 이상이어야 합니다`
    }

    if (movementType === 'TRANSFER') {
      if (!toLocationId) return '도착 위치를 선택하세요'
      if (toLocationId === locationId) return '출발지와 도착지가 같을 수 없습니다'
    }
    if (movementType === 'OUTBOUND') {
      if (!channelId) return '판매 채널을 선택하세요'
    }
    if (movementType === 'ADJUSTMENT') {
      if (!reason.trim()) return '조정 사유를 입력하세요'
    }
    return null
  }

  async function handleSubmit() {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    setSubmitting(true)
    try {
      const targets = selectedTargets()
      const results = await Promise.allSettled(
        targets.map(async (t) => {
          const body: Record<string, unknown> = {
            type: movementType,
            optionId: t.optionId,
            locationId,
            quantity: t.quantity,
            movementDate,
          }
          if (movementType === 'TRANSFER') body.toLocationId = toLocationId
          if (movementType === 'OUTBOUND') {
            body.channelId = channelId
            if (orderDate) body.orderDate = orderDate
          }
          if (movementType === 'RETURN' && referenceId.trim()) {
            body.referenceId = referenceId.trim()
          }
          if (movementType === 'ADJUSTMENT') body.reason = reason.trim()

          const res = await fetch('/api/sh/inventory/movements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data?.error ?? '실패')
          }
        })
      )

      const ok = results.filter((r) => r.status === 'fulfilled').length
      const failures = results
        .map((r, i) => ({
          result: r,
          name: optionEntries.find((e) => e.optionId === targets[i].optionId)?.optionName ?? '',
        }))
        .filter((x) => x.result.status === 'rejected')
      const ng = failures.length

      if (ng === 0) {
        toast.success(`${ok}건 등록 완료`)
        setOpen(false)
        resetForm()
        onCreated?.()
      } else if (ok === 0) {
        toast.error(`전체 실패 (${ng}건): ${failures.map((f) => f.name).join(', ')}`)
      } else {
        toast.warning(`${ok}건 성공 / ${ng}건 실패: ${failures.map((f) => f.name).join(', ')}`)
        onCreated?.()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCount = optionEntries.filter((e) => e.selected).length
  const totalQty = optionEntries
    .filter((e) => e.selected)
    .reduce((s, e) => s + (Number(e.quantity) || 0), 0)
  const allSelected = optionEntries.length > 0 && selectedCount === optionEntries.length

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" />
          신규 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>재고 이동 기록 등록</DialogTitle>
          <DialogDescription>
            입고 / 출고 / 반품 / 이동 / 조정 기록을 옵션별로 일괄 등록합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Type selector */}
          <div className="space-y-2">
            <Label>이동 유형</Label>
            <div className="flex flex-wrap gap-2">
              {TYPE_OPTIONS.map((t) => (
                <Button
                  key={t.value}
                  type="button"
                  size="sm"
                  variant={movementType === t.value ? 'default' : 'outline'}
                  onClick={() => setMovementType(t.value)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Product selector */}
          <div className="space-y-2">
            <Label>상품</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="상품 선택" />
              </SelectTrigger>
              <SelectContent>
                {products.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    등록된 상품이 없습니다
                  </SelectItem>
                ) : (
                  products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.code ? ` (${p.code})` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              찾는 상품이 없나요?{' '}
              <a
                href="/d/seller-hub/products/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                상품을 먼저 등록
              </a>
              하세요. 등록 후 이 화면으로 돌아오면 자동으로 목록이 갱신됩니다.
            </p>
          </div>

          {/* Options multi-select */}
          {productId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>옵션 선택 (체크 후 수량 입력)</Label>
                {optionEntries.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => toggleAll(!allSelected)}
                  >
                    {allSelected ? '전체 해제' : '전체 선택'}
                  </button>
                )}
              </div>
              <div className="rounded-md border">
                {loadingOptions ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    옵션 불러오는 중...
                  </div>
                ) : optionEntries.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    옵션이 없습니다
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {optionEntries.map((e) => (
                      <div
                        key={e.optionId}
                        className={`flex items-center gap-3 border-b px-3 py-2 last:border-b-0 ${
                          e.selected ? 'bg-primary/5' : ''
                        }`}
                      >
                        <Checkbox
                          checked={e.selected}
                          onCheckedChange={(v) => updateEntry(e.optionId, { selected: v === true })}
                          aria-label={`${e.optionName} 선택`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{e.optionName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {e.sku ? `${e.sku} · ` : ''}재고 {e.totalStock.toLocaleString('ko-KR')}
                          </p>
                        </div>
                        <Input
                          type="number"
                          className="h-8 w-24"
                          value={e.quantity}
                          onChange={(ev) =>
                            updateEntry(e.optionId, {
                              quantity: ev.target.value,
                              selected: ev.target.value !== '' ? true : e.selected,
                            })
                          }
                          placeholder={movementType === 'ADJUSTMENT' ? '실물' : '수량'}
                          disabled={!e.selected}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  선택 {selectedCount}개 · 총 {totalQty.toLocaleString('ko-KR')}개
                </p>
              )}
            </div>
          )}

          {/* Location(s) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{movementType === 'TRANSFER' ? '출발 위치' : '위치'}</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="위치 선택" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {movementType === 'TRANSFER' && (
              <div className="space-y-2">
                <Label>도착 위치</Label>
                <Select value={toLocationId} onValueChange={setToLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="도착 위치 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations
                      .filter((l) => l.id !== locationId)
                      .map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* OUTBOUND extras */}
          {movementType === 'OUTBOUND' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>판매 채널</Label>
                {!creatingChannel ? (
                  <Select
                    value={channelId}
                    onValueChange={(v) => {
                      if (v === '__new__') {
                        setCreatingChannel(true)
                      } else {
                        setChannelId(v)
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="채널 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__">+ 새 채널 등록</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      placeholder="새 채널 이름"
                    />
                    <Button type="button" size="sm" onClick={handleCreateChannel}>
                      생성
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCreatingChannel(false)
                        setNewChannelName('')
                      }}
                    >
                      취소
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>주문 일자</Label>
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* RETURN extras */}
          {movementType === 'RETURN' && (
            <div className="space-y-2">
              <Label>참조 이동 ID (선택)</Label>
              <Input
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                placeholder="원본 출고 이동 ID"
              />
            </div>
          )}

          {/* ADJUSTMENT reason */}
          {movementType === 'ADJUSTMENT' && (
            <div className="space-y-2">
              <Label>조정 사유 *</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="예: 실사 결과 차이 조정"
                rows={2}
              />
            </div>
          )}

          {/* Date */}
          <div className="space-y-2">
            <Label>{DATE_LABEL[movementType]}</Label>
            <Input
              type="date"
              value={movementDate}
              onChange={(e) => setMovementDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                처리 중...
              </>
            ) : (
              `등록${selectedCount > 0 ? ` (${selectedCount}건)` : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
