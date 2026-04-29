'use client'

import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ─── 타입 ────────────────────────────────────────────────────────────────────

type ChannelTypeDef = {
  id: string
  name: string
  isSalesChannel: boolean
  isSystem: boolean
  sortOrder: number
  channelCount: number
}

type FeeRateRow = {
  categoryName: string
  ratePercent: string // 폼 입력 — UI는 % (0~100)
}

type Channel = {
  id: string
  name: string
  channelTypeDefId: string | null
  channelTypeDef: { id: string; name: string; isSalesChannel: boolean } | null
  useSimulation: boolean
  adminUrl: string | null
  freeShipping: boolean
  freeShippingThreshold: number | null
  feeRates: { categoryName: string; ratePercent: number }[]
  usesMarketingBudget: boolean
  applyAdCost: boolean
  shippingFee: number | null
  vatIncludedInFee: boolean
  paymentFeeIncluded: boolean
  paymentFeePct: number | null // DB/API는 0~1 소수
  isActive: boolean
  requireOrderNumber: boolean
  requirePayment: boolean
  requireProducts: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null이면 신규 생성 */
  channel: Channel | null
  channelTypes: ChannelTypeDef[]
  onSaved: () => void
  onTypesChanged: () => void
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const NO_TYPE = '__none__'
const NEW_TYPE = '__new__'

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function ChannelEditDialog({
  open,
  onOpenChange,
  channel,
  channelTypes,
  onSaved,
  onTypesChanged,
}: Props) {
  // ── 기본 탭 ──
  const [fTypeDefId, setFTypeDefId] = useState(NO_TYPE)
  const [fName, setFName] = useState('')
  const [fAdminUrl, setFAdminUrl] = useState('')
  const [fUsesMarketing, setFUsesMarketing] = useState(false)
  const [fApplyAdCost, setFApplyAdCost] = useState(false)
  const [fUseSimulation, setFUseSimulation] = useState(true)
  const [fIsActive, setFIsActive] = useState(true)

  // 인라인 유형 생성
  const [creatingType, setCreatingType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeIsSales, setNewTypeIsSales] = useState(true)
  const [savingNewType, setSavingNewType] = useState(false)

  // ── 수수료 탭 ──
  const [fVatIncluded, setFVatIncluded] = useState(false)
  const [fPaymentFeeIncluded, setFPaymentFeeIncluded] = useState(true)
  const [fPaymentFeePct, setFPaymentFeePct] = useState('') // UI: %, 저장 시 /100
  const [feeRows, setFeeRows] = useState<FeeRateRow[]>([{ categoryName: '기본', ratePercent: '0' }])

  // ── 배송 탭 ──
  const [fShippingFee, setFShippingFee] = useState('')
  const [fFreeShipping, setFFreeShipping] = useState(false)
  const [fFreeShippingThreshold, setFFreeShippingThreshold] = useState('')

  // ── 고급 탭 ──
  const [fRequireOrderNumber, setFRequireOrderNumber] = useState(false)
  const [fRequirePayment, setFRequirePayment] = useState(false)
  const [fRequireProducts, setFRequireProducts] = useState(false)

  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')

  // ── Dialog 열릴 때 폼 초기화 ──

  useEffect(() => {
    if (!open) return
    setActiveTab('basic')
    setCreatingType(false)
    setNewTypeName('')
    setNewTypeIsSales(true)

    if (channel) {
      // 수정 모드
      setFTypeDefId(channel.channelTypeDefId ?? NO_TYPE)
      setFName(channel.name)
      setFAdminUrl(channel.adminUrl ?? '')
      setFUsesMarketing(channel.usesMarketingBudget)
      setFApplyAdCost(channel.applyAdCost)
      setFUseSimulation(channel.useSimulation)
      setFIsActive(channel.isActive)

      setFVatIncluded(channel.vatIncludedInFee)
      setFPaymentFeeIncluded(channel.paymentFeeIncluded)
      // paymentFeePct는 DB 0~1 → UI * 100
      setFPaymentFeePct(channel.paymentFeePct != null ? String(channel.paymentFeePct * 100) : '')

      // feeRates 초기화 — '기본'이 없으면 첫 행에 추가
      const rows = channel.feeRates.map((fr) => ({
        categoryName: fr.categoryName,
        ratePercent: String(fr.ratePercent),
      }))
      const hasBase = rows.some((r) => r.categoryName === '기본')
      if (!hasBase) rows.unshift({ categoryName: '기본', ratePercent: '0' })
      setFeeRows(rows)

      setFShippingFee(channel.shippingFee != null ? String(channel.shippingFee) : '')
      setFFreeShipping(channel.freeShipping)
      setFFreeShippingThreshold(
        channel.freeShippingThreshold != null ? String(channel.freeShippingThreshold) : ''
      )

      setFRequireOrderNumber(channel.requireOrderNumber)
      setFRequirePayment(channel.requirePayment)
      setFRequireProducts(channel.requireProducts)
    } else {
      // 신규 모드
      setFTypeDefId(NO_TYPE)
      setFName('')
      setFAdminUrl('')
      setFUsesMarketing(false)
      setFApplyAdCost(false)
      setFUseSimulation(true)
      setFIsActive(true)

      setFVatIncluded(false)
      setFPaymentFeeIncluded(true)
      setFPaymentFeePct('')
      setFeeRows([{ categoryName: '기본', ratePercent: '0' }])

      setFShippingFee('')
      setFFreeShipping(false)
      setFFreeShippingThreshold('')

      setFRequireOrderNumber(false)
      setFRequirePayment(false)
      setFRequireProducts(false)
    }
  }, [open, channel])

  // ── 인라인 유형 생성 ──

  async function handleCreateTypeInline() {
    const name = newTypeName.trim()
    if (!name) return
    setSavingNewType(true)
    try {
      const res = await fetch('/api/channel-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, isSalesChannel: newTypeIsSales }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '유형 생성 실패')
      setFTypeDefId(data.type.id)
      setCreatingType(false)
      setNewTypeName('')
      toast.success(`채널 유형 "${data.type.name}" 이(가) 생성되었습니다`)
      onTypesChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '유형 생성 실패')
    } finally {
      setSavingNewType(false)
    }
  }

  // ── 수수료 행 조작 ──

  function addFeeRow() {
    setFeeRows((prev) => [...prev, { categoryName: '', ratePercent: '0' }])
  }

  function removeFeeRow(idx: number) {
    setFeeRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateFeeRow(idx: number, field: keyof FeeRateRow, value: string) {
    setFeeRows((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)))
  }

  // ── 저장 ──

  async function handleSave() {
    if (!fName.trim()) {
      toast.error('채널명을 입력해 주세요')
      return
    }
    if (!fTypeDefId || fTypeDefId === NO_TYPE) {
      toast.error('채널 유형을 선택해 주세요')
      return
    }

    // feeRates 검증 — 카테고리명 비어있는 행 제거 후 중복 체크
    const validRows = feeRows.filter((r) => r.categoryName.trim() !== '')
    const names = validRows.map((r) => r.categoryName.trim())
    const hasDup = names.length !== new Set(names).size
    if (hasDup) {
      toast.error('카테고리명이 중복되었습니다. 중복을 제거해 주세요')
      return
    }

    setSaving(true)
    try {
      const url = channel ? `/api/channels/${channel.id}` : '/api/channels'
      const method = channel ? 'PATCH' : 'POST'

      const body: Record<string, unknown> = {
        name: fName.trim(),
        channelTypeDefId: fTypeDefId,
        useSimulation: fUseSimulation,
        freeShipping: fFreeShipping,
        usesMarketingBudget: fUsesMarketing,
        applyAdCost: fApplyAdCost,
        vatIncludedInFee: fVatIncluded,
        paymentFeeIncluded: fPaymentFeeIncluded,
        isActive: fIsActive,
        requireOrderNumber: fRequireOrderNumber,
        requirePayment: fRequirePayment,
        requireProducts: fRequireProducts,
        // feeRates 전송 — UI는 %, DB도 ratePercent(0~100)이므로 변환 없이 그대로
        feeRates: validRows.map((r) => ({
          categoryName: r.categoryName.trim(),
          ratePercent: parseFloat(r.ratePercent) || 0,
        })),
      }

      if (fAdminUrl.trim()) body.adminUrl = fAdminUrl.trim()
      else body.adminUrl = null

      if (fShippingFee) body.shippingFee = parseFloat(fShippingFee)
      if (fFreeShippingThreshold && !fFreeShipping)
        body.freeShippingThreshold = parseFloat(fFreeShippingThreshold)

      // paymentFeePct: UI % → DB 소수 (0~1)
      if (!fPaymentFeeIncluded && fPaymentFeePct) {
        body.paymentFeePct = parseFloat(fPaymentFeePct) / 100
      } else {
        body.paymentFeePct = null
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        const fieldErrors = data?.errors?.fieldErrors as
          | Record<string, string[] | undefined>
          | undefined
        const firstField = fieldErrors
          ? Object.entries(fieldErrors).find(([, v]) => v && v.length > 0)
          : undefined
        const suffix = firstField ? ` (${firstField[0]}: ${firstField[1]?.[0]})` : ''
        throw new Error((data?.message ?? '저장 실패') + suffix)
      }
      toast.success(channel ? '채널이 수정되었습니다' : '채널이 생성되었습니다')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{channel ? '채널 수정' : '새 채널 만들기'}</DialogTitle>
          <DialogDescription>판매 채널 정보를 입력해 주세요</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="basic" className="flex-1">
              기본
            </TabsTrigger>
            <TabsTrigger
              value="fee"
              className={!fUseSimulation ? 'flex-1 text-muted-foreground' : 'flex-1'}
            >
              수수료
            </TabsTrigger>
            <TabsTrigger
              value="shipping"
              className={!fUseSimulation ? 'flex-1 text-muted-foreground' : 'flex-1'}
            >
              배송
            </TabsTrigger>
            <TabsTrigger value="advanced" className="flex-1">
              고급
            </TabsTrigger>
          </TabsList>

          {/* ── 기본 탭 ── */}
          <TabsContent value="basic" className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {/* 채널 유형 */}
            <div className="space-y-2">
              <Label>채널 유형 *</Label>
              {!creatingType ? (
                <Select
                  value={fTypeDefId}
                  onValueChange={(v) => {
                    if (v === NEW_TYPE) {
                      setCreatingType(true)
                      setNewTypeName('')
                    } else {
                      setFTypeDefId(v)
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="유형 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TYPE}>유형 없음</SelectItem>
                    {channelTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_TYPE}>+ 새 유형 만들기</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  <Input
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    placeholder="새 유형 이름"
                    autoFocus
                    disabled={savingNewType}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="new-type-is-sales"
                        checked={newTypeIsSales}
                        onCheckedChange={setNewTypeIsSales}
                        disabled={savingNewType}
                      />
                      <Label htmlFor="new-type-is-sales" className="cursor-pointer text-sm">
                        {newTypeIsSales ? '판매채널' : '내부 이관'}
                      </Label>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreateTypeInline}
                        disabled={savingNewType || !newTypeName.trim()}
                      >
                        {savingNewType ? '생성 중...' : '생성'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCreatingType(false)
                          setNewTypeName('')
                        }}
                        disabled={savingNewType}
                      >
                        취소
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 채널명 */}
            <div className="space-y-2">
              <Label htmlFor="ch-name">채널명 *</Label>
              <Input
                id="ch-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="예: 쿠팡"
              />
            </div>

            {/* 어드민 URL */}
            <div className="space-y-2">
              <Label htmlFor="ch-admin-url">어드민 URL (선택)</Label>
              <Input
                id="ch-admin-url"
                value={fAdminUrl}
                onChange={(e) => setFAdminUrl(e.target.value)}
                placeholder="https://wing.coupang.com/..."
              />
            </div>

            {/* 마케팅 */}
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">마케팅</p>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="ch-marketing">마케팅 예산 사용</Label>
                  <p className="text-xs text-muted-foreground">채널 광고비 별도 운영</p>
                </div>
                <Switch
                  id="ch-marketing"
                  checked={fUsesMarketing}
                  onCheckedChange={setFUsesMarketing}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="ch-apply-ad">광고비 자동 적용</Label>
                  <p className="text-xs text-muted-foreground">시뮬레이션 시 광고비 자동 포함</p>
                </div>
                <Switch id="ch-apply-ad" checked={fApplyAdCost} onCheckedChange={setFApplyAdCost} />
              </div>
            </div>

            {/* 가격 시뮬레이션 */}
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="ch-use-sim" className="cursor-pointer">
                  가격 시뮬레이션 사용
                </Label>
                <p className="text-xs text-muted-foreground">
                  OFF 시 수수료·배송 설정이 시뮬레이션에서 제외됩니다
                </p>
              </div>
              <Switch
                id="ch-use-sim"
                checked={fUseSimulation}
                onCheckedChange={setFUseSimulation}
              />
            </div>

            {/* 활성 상태 */}
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="ch-active">활성 상태</Label>
                <p className="text-xs text-muted-foreground">비활성 시 신규 주문에 사용 불가</p>
              </div>
              <Switch id="ch-active" checked={fIsActive} onCheckedChange={setFIsActive} />
            </div>
          </TabsContent>

          {/* ── 수수료 탭 ── */}
          <TabsContent value="fee" className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {!fUseSimulation && (
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                가격 시뮬레이션이 OFF입니다. 수수료 설정은 저장되지만 시뮬레이션에 반영되지
                않습니다.
              </div>
            )}

            {/* VAT 포함 */}
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="ch-vat" className="cursor-pointer">
                  수수료에 VAT 포함
                </Label>
                <p className="text-xs text-muted-foreground">
                  채널 전체 수수료율에 부가세 포함 기준
                </p>
              </div>
              <Switch id="ch-vat" checked={fVatIncluded} onCheckedChange={setFVatIncluded} />
            </div>

            {/* 결제 수수료 */}
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="ch-payment-included" className="cursor-pointer">
                  결제 수수료 포함
                </Label>
                <p className="text-xs text-muted-foreground">
                  수수료율에 결제 수수료가 합산되어 있으면 ON
                </p>
              </div>
              <Switch
                id="ch-payment-included"
                checked={fPaymentFeeIncluded}
                onCheckedChange={setFPaymentFeeIncluded}
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="ch-payment-fee"
                className={fPaymentFeeIncluded ? 'text-muted-foreground' : undefined}
              >
                결제 수수료율 (%)
              </Label>
              <Input
                id="ch-payment-fee"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={fPaymentFeeIncluded ? '' : fPaymentFeePct}
                onChange={(e) => setFPaymentFeePct(e.target.value)}
                placeholder={fPaymentFeeIncluded ? '결제 수수료 포함 시 사용 안 함' : '예: 3.5'}
                disabled={fPaymentFeeIncluded}
              />
            </div>

            <div className="border-t pt-3">
              <p className="mb-3 text-xs font-medium text-muted-foreground">카테고리별 수수료</p>

              {/* 8개 초과 시 스크롤 */}
              <div className={feeRows.length > 8 ? 'max-h-80 overflow-y-auto' : undefined}>
                <div className="space-y-2">
                  {feeRows.map((row, idx) => {
                    const isBase = row.categoryName === '기본'
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          className="flex-1 text-sm"
                          value={row.categoryName}
                          onChange={(e) => updateFeeRow(idx, 'categoryName', e.target.value)}
                          placeholder="카테고리명"
                          disabled={isBase}
                          aria-label="카테고리명"
                        />
                        <div className="flex w-32 shrink-0 items-center gap-1">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            className="text-sm"
                            value={row.ratePercent}
                            onChange={(e) => updateFeeRow(idx, 'ratePercent', e.target.value)}
                            aria-label="수수료율"
                          />
                          <span className="shrink-0 text-xs text-muted-foreground">%</span>
                        </div>
                        {isBase ? (
                          <div className="w-7 shrink-0" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground"
                            onClick={() => removeFeeRow(idx)}
                            aria-label="행 삭제"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={addFeeRow}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                카테고리 추가
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                수수료 수정은 이 다이얼로그 [수수료] 탭에서 처리합니다
              </p>
            </div>
          </TabsContent>

          {/* ── 배송 탭 ── */}
          <TabsContent
            value="shipping"
            className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto pr-1"
          >
            {!fUseSimulation && (
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                가격 시뮬레이션이 OFF입니다. 배송 설정은 저장되지만 시뮬레이션에 반영되지 않습니다.
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ch-shipping-fee">기본 배송비 (원)</Label>
              <Input
                id="ch-shipping-fee"
                type="number"
                min="0"
                value={fShippingFee}
                onChange={(e) => setFShippingFee(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="ch-free-shipping" className="cursor-pointer">
                  무료 배송
                </Label>
                <p className="text-xs text-muted-foreground">이 채널은 항상 무료배송</p>
              </div>
              <Switch
                id="ch-free-shipping"
                checked={fFreeShipping}
                onCheckedChange={setFFreeShipping}
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="ch-free-threshold"
                className={fFreeShipping ? 'text-muted-foreground' : undefined}
              >
                무료 배송 기준금액 (원)
              </Label>
              <Input
                id="ch-free-threshold"
                type="number"
                min="0"
                step="1000"
                value={fFreeShipping ? '' : fFreeShippingThreshold}
                onChange={(e) => setFFreeShippingThreshold(e.target.value)}
                placeholder={fFreeShipping ? '항상 무료배송 (사용 안 함)' : '예: 50000'}
                disabled={fFreeShipping}
              />
            </div>
          </TabsContent>

          {/* ── 고급 탭 ── */}
          <TabsContent
            value="advanced"
            className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto pr-1"
          >
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">주문 요구사항</p>
              <div className="flex items-center justify-between">
                <Label htmlFor="ch-req-order" className="cursor-pointer">
                  주문번호 필수
                </Label>
                <Switch
                  id="ch-req-order"
                  checked={fRequireOrderNumber}
                  onCheckedChange={setFRequireOrderNumber}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="ch-req-payment" className="cursor-pointer">
                  결제 필수
                </Label>
                <Switch
                  id="ch-req-payment"
                  checked={fRequirePayment}
                  onCheckedChange={setFRequirePayment}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="ch-req-products" className="cursor-pointer">
                  상품 필수
                </Label>
                <Switch
                  id="ch-req-products"
                  checked={fRequireProducts}
                  onCheckedChange={setFRequireProducts}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
