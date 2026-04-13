'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export function MovementForm({ onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [movementType, setMovementType] = useState<MovementType>('INBOUND')

  // Common fields
  const [productId, setProductId] = useState<string>('')
  const [optionId, setOptionId] = useState<string>('')
  const [locationId, setLocationId] = useState<string>('')
  const [toLocationId, setToLocationId] = useState<string>('')
  const [quantity, setQuantity] = useState<string>('')
  const [movementDate, setMovementDate] = useState<string>(todayStr())
  const [orderDate, setOrderDate] = useState<string>(todayStr())
  const [channelId, setChannelId] = useState<string>('')
  const [reason, setReason] = useState<string>('')
  const [referenceId, setReferenceId] = useState<string>('')

  // INBOUND new-product fields
  const [inboundMode, setInboundMode] = useState<'existing' | 'new'>('existing')
  const [newProductName, setNewProductName] = useState('')
  const [newProductCode, setNewProductCode] = useState('')
  const [newOptionName, setNewOptionName] = useState('')
  const [newOptionSku, setNewOptionSku] = useState('')

  // Lookups
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [channels, setChannels] = useState<ChannelItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [options, setOptions] = useState<OptionItem[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)

  // New channel inline create
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')

  const resetForm = useCallback(() => {
    setMovementType('INBOUND')
    setProductId('')
    setOptionId('')
    setLocationId('')
    setToLocationId('')
    setQuantity('')
    setMovementDate(todayStr())
    setOrderDate(todayStr())
    setChannelId('')
    setReason('')
    setReferenceId('')
    setInboundMode('existing')
    setNewProductName('')
    setNewProductCode('')
    setNewOptionName('')
    setNewOptionSku('')
    setOptions([])
    setCreatingChannel(false)
    setNewChannelName('')
  }, [])

  // Fetch lookups when dialog opens
  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const [locRes, prodRes, chRes] = await Promise.all([
          fetch('/api/inv/locations?isActive=true'),
          fetch('/api/inv/products?pageSize=500'),
          fetch('/api/inv/channels?isActive=true'),
        ])
        if (locRes.ok) {
          const j = await locRes.json()
          setLocations(j.locations ?? [])
        }
        if (prodRes.ok) {
          const j = await prodRes.json()
          setProducts(j.data ?? [])
        }
        if (chRes.ok) {
          const j = await chRes.json()
          setChannels(j.channels ?? [])
        }
      } catch {
        toast.error('초기 데이터를 불러오지 못했습니다')
      }
    })()
  }, [open])

  // When product changes, fetch its options
  useEffect(() => {
    if (!productId) {
      setOptions([])
      setOptionId('')
      return
    }
    let cancelled = false
    setLoadingOptions(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/inv/products/${productId}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (cancelled) return
        setOptions(data.options ?? [])
        setOptionId('')
      } catch {
        if (!cancelled) {
          setOptions([])
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

  function needsExistingOption(): boolean {
    if (movementType === 'INBOUND' && inboundMode === 'new') return false
    return true
  }

  function validate(): string | null {
    const qty = Number(quantity)
    if (!movementDate) return '날짜를 입력하세요'
    if (!Number.isFinite(qty)) return '수량을 입력하세요'
    if (movementType !== 'ADJUSTMENT' && qty <= 0) return '수량은 1 이상이어야 합니다'
    if (!locationId) return '위치를 선택하세요'

    if (needsExistingOption()) {
      if (!optionId) return '상품/옵션을 선택하세요'
    } else {
      // INBOUND + new
      if (!newProductName.trim()) return '새 상품명을 입력하세요'
      if (!newOptionName.trim()) return '새 옵션명을 입력하세요'
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
      const body: Record<string, unknown> = {
        type: movementType,
        locationId,
        quantity: Number(quantity),
        movementDate,
      }

      if (needsExistingOption()) {
        body.optionId = optionId
      } else {
        body.productName = newProductName.trim()
        body.optionName = newOptionName.trim()
        if (newProductCode.trim()) body.productCode = newProductCode.trim()
        if (newOptionSku.trim()) body.optionSku = newOptionSku.trim()
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

      const res = await fetch('/api/inv/movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error ?? '이동 기록 생성 실패')
      }
      const warnings: string[] = Array.isArray(data?.warnings) ? data.warnings : []
      if (warnings.length > 0) {
        toast.warning(`등록되었으나 경고: ${warnings.join(' / ')}`)
      } else {
        toast.success('이동 기록이 등록되었습니다')
      }
      setOpen(false)
      resetForm()
      onCreated?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '이동 기록 생성 실패')
    } finally {
      setSubmitting(false)
    }
  }

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
          <Plus className="mr-1 h-4 w-4" />새 이동 기록
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>재고 이동 기록 등록</DialogTitle>
          <DialogDescription>
            입고 / 출고 / 반품 / 이동 / 조정 기록을 직접 등록합니다.
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

          {/* INBOUND mode toggle */}
          {movementType === 'INBOUND' && (
            <div className="space-y-2">
              <Label>상품 선택 방식</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={inboundMode === 'existing' ? 'default' : 'outline'}
                  onClick={() => setInboundMode('existing')}
                >
                  기존 상품 선택
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={inboundMode === 'new' ? 'default' : 'outline'}
                  onClick={() => setInboundMode('new')}
                >
                  새 상품 등록
                </Button>
              </div>
            </div>
          )}

          {/* Existing product/option picker */}
          {needsExistingOption() && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              </div>
              <div className="space-y-2">
                <Label>옵션</Label>
                <Select
                  value={optionId}
                  onValueChange={setOptionId}
                  disabled={!productId || loadingOptions}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !productId
                          ? '상품 먼저 선택'
                          : loadingOptions
                            ? '불러오는 중...'
                            : '옵션 선택'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {options.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        옵션 없음
                      </SelectItem>
                    ) : (
                      options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                          {o.sku ? ` · ${o.sku}` : ''} (재고 {o.totalStock})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* New product fields (INBOUND + new) */}
          {movementType === 'INBOUND' && inboundMode === 'new' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>새 상품명 *</Label>
                <Input
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder="예: 콜라 500ml"
                />
              </div>
              <div className="space-y-2">
                <Label>제품코드 (선택)</Label>
                <Input
                  value={newProductCode}
                  onChange={(e) => setNewProductCode(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>옵션명 *</Label>
                <Input
                  value={newOptionName}
                  onChange={(e) => setNewOptionName(e.target.value)}
                  placeholder="예: 기본"
                />
              </div>
              <div className="space-y-2">
                <Label>SKU (선택)</Label>
                <Input
                  value={newOptionSku}
                  onChange={(e) => setNewOptionSku(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Quantity + location(s) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>
                {movementType === 'ADJUSTMENT' ? '실물 수량 (절대값)' : '수량'}
              </Label>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </div>
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
              <div className="space-y-2 sm:col-span-2">
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
            <Label>이동 날짜</Label>
            <Input
              type="date"
              value={movementDate}
              onChange={(e) => setMovementDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                처리 중...
              </>
            ) : (
              '등록'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
