'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

/** 전체 17개 필드 — pricing-sim-main의 FullSettings와 호환 */
export type PricingFullSettings = {
  // 기본 비용 (0~100 % 단위 그대로 DB 저장)
  defaultOperatingCostPct: number
  defaultAdCostPct: number
  defaultPackagingCost: number
  // 채널 및 배송 (0~1 단위 DB 저장, UI에서 % 표시)
  defaultChannelFeePct: number
  defaultShippingCost: number
  autoApplyChannelFee: boolean
  autoApplyAdCost: boolean
  autoApplyShipping: boolean
  // 반품 / 교환
  defaultReturnRate: number
  defaultReturnShipping: number
  // 마진 등급 임계값 (0~1 단위 DB 저장, UI에서 % 표시)
  selfMallTargetGood: number
  selfMallTargetFair: number
  platformTargetGood: number
  platformTargetFair: number
  minimumAcceptableMargin: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 부모에서 이미 로드한 초기값 (전체 설정 객체) */
  initialSettings: PricingFullSettings
  /** 저장 완료 후 부모에게 최신 전체값 전달 */
  onSaved?: (settings: PricingFullSettings) => void
}

// ─── 헬퍼: 숫자 input용 suffix span ───────────────────────────────────────────

function SuffixInput({
  id,
  value,
  onChange,
  suffix,
  dirty,
  ...rest
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  suffix: string
  dirty?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'id'>) {
  return (
    <div className="relative flex items-center">
      <Input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-8 [appearance:textfield] pr-8 text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          dirty && 'border-amber-400'
        )}
        {...rest}
      />
      <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
        {suffix}
      </span>
    </div>
  )
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function PricingDefaultsDialog({ open, onOpenChange, initialSettings, onSaved }: Props) {
  // 기본 비용
  const adId = useId()
  const opId = useId()
  const packId = useId()

  // 채널 및 배송
  const chFeeId = useId()
  const shipId = useId()
  const autoChId = useId()
  const autoAdId = useId()
  const autoShipId = useId()

  // 반품 / 교환
  const retRateId = useId()
  const retShipId = useId()

  // 마진 등급
  const smGoodId = useId()
  const smFairId = useId()
  const plGoodId = useId()
  const plFairId = useId()
  const minMgnId = useId()

  // 저장 완료 기준점 (dirty 체크용)
  const savedRef = useRef<PricingFullSettings>(initialSettings)

  // ── 편집 상태 ─────────────────────────────────────────────────────────────

  // 기본 비용 (0~100 그대로)
  const [adCost, setAdCost] = useState(String(initialSettings.defaultAdCostPct))
  const [opCost, setOpCost] = useState(String(initialSettings.defaultOperatingCostPct))
  const [packCost, setPackCost] = useState(String(initialSettings.defaultPackagingCost))

  // 채널 및 배송 (0~1 → % 표시)
  const [channelFeePct, setChannelFeePct] = useState(
    String(initialSettings.defaultChannelFeePct * 100)
  )
  const [shippingCost, setShippingCost] = useState(String(initialSettings.defaultShippingCost))
  const [autoChannelFee, setAutoChannelFee] = useState(initialSettings.autoApplyChannelFee)
  const [autoAdCost, setAutoAdCost] = useState(initialSettings.autoApplyAdCost)
  const [autoShipping, setAutoShipping] = useState(initialSettings.autoApplyShipping)

  // 반품 / 교환 (0~1 → % 표시)
  const [returnRate, setReturnRate] = useState(String(initialSettings.defaultReturnRate * 100))
  const [returnShipping, setReturnShipping] = useState(
    String(initialSettings.defaultReturnShipping)
  )

  // 마진 등급 (0~1 → % 표시)
  const [selfMallGood, setSelfMallGood] = useState(String(initialSettings.selfMallTargetGood * 100))
  const [selfMallFair, setSelfMallFair] = useState(String(initialSettings.selfMallTargetFair * 100))
  const [platformGood, setPlatformGood] = useState(String(initialSettings.platformTargetGood * 100))
  const [platformFair, setPlatformFair] = useState(String(initialSettings.platformTargetFair * 100))
  const [minMargin, setMinMargin] = useState(String(initialSettings.minimumAcceptableMargin * 100))

  const [saving, setSaving] = useState(false)

  // ── initialSettings 외부 변경 시 동기화 ────────────────────────────────────

  useEffect(() => {
    const s = initialSettings
    setAdCost(String(s.defaultAdCostPct))
    setOpCost(String(s.defaultOperatingCostPct))
    setPackCost(String(s.defaultPackagingCost))
    setChannelFeePct(String(s.defaultChannelFeePct * 100))
    setShippingCost(String(s.defaultShippingCost))
    setAutoChannelFee(s.autoApplyChannelFee)
    setAutoAdCost(s.autoApplyAdCost)
    setAutoShipping(s.autoApplyShipping)
    setReturnRate(String(s.defaultReturnRate * 100))
    setReturnShipping(String(s.defaultReturnShipping))
    setSelfMallGood(String(s.selfMallTargetGood * 100))
    setSelfMallFair(String(s.selfMallTargetFair * 100))
    setPlatformGood(String(s.platformTargetGood * 100))
    setPlatformFair(String(s.platformTargetFair * 100))
    setMinMargin(String(s.minimumAcceptableMargin * 100))
    savedRef.current = s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialSettings.defaultAdCostPct,
    initialSettings.defaultOperatingCostPct,
    initialSettings.defaultPackagingCost,
    initialSettings.defaultChannelFeePct,
    initialSettings.defaultShippingCost,
    initialSettings.autoApplyChannelFee,
    initialSettings.autoApplyAdCost,
    initialSettings.autoApplyShipping,
    initialSettings.defaultReturnRate,
    initialSettings.defaultReturnShipping,
    initialSettings.selfMallTargetGood,
    initialSettings.selfMallTargetFair,
    initialSettings.platformTargetGood,
    initialSettings.platformTargetFair,
    initialSettings.minimumAcceptableMargin,
  ])

  // ── Dialog 닫힐 때 미저장 변경사항 리셋 ───────────────────────────────────

  function resetToSaved() {
    const s = savedRef.current
    setAdCost(String(s.defaultAdCostPct))
    setOpCost(String(s.defaultOperatingCostPct))
    setPackCost(String(s.defaultPackagingCost))
    setChannelFeePct(String(s.defaultChannelFeePct * 100))
    setShippingCost(String(s.defaultShippingCost))
    setAutoChannelFee(s.autoApplyChannelFee)
    setAutoAdCost(s.autoApplyAdCost)
    setAutoShipping(s.autoApplyShipping)
    setReturnRate(String(s.defaultReturnRate * 100))
    setReturnShipping(String(s.defaultReturnShipping))
    setSelfMallGood(String(s.selfMallTargetGood * 100))
    setSelfMallFair(String(s.selfMallTargetFair * 100))
    setPlatformGood(String(s.platformTargetGood * 100))
    setPlatformFair(String(s.platformTargetFair * 100))
    setMinMargin(String(s.minimumAcceptableMargin * 100))
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      Promise.resolve().then(resetToSaved)
    }
    onOpenChange(next)
  }

  // ── dirty 체크 ─────────────────────────────────────────────────────────────

  const adVal = parseFloat(adCost)
  const opVal = parseFloat(opCost)
  const packVal = parseFloat(packCost)
  const chFeeVal = parseFloat(channelFeePct)
  const shipVal = parseFloat(shippingCost)
  const retRateVal = parseFloat(returnRate)
  const retShipVal = parseFloat(returnShipping)
  const smGoodVal = parseFloat(selfMallGood)
  const smFairVal = parseFloat(selfMallFair)
  const plGoodVal = parseFloat(platformGood)
  const plFairVal = parseFloat(platformFair)
  const minMgnVal = parseFloat(minMargin)

  const allValid =
    !isNaN(adVal) &&
    !isNaN(opVal) &&
    !isNaN(packVal) &&
    !isNaN(chFeeVal) &&
    !isNaN(shipVal) &&
    !isNaN(retRateVal) &&
    !isNaN(retShipVal) &&
    !isNaN(smGoodVal) &&
    !isNaN(smFairVal) &&
    !isNaN(plGoodVal) &&
    !isNaN(plFairVal) &&
    !isNaN(minMgnVal)

  const ref = savedRef.current
  const isDirty =
    allValid &&
    (adVal !== ref.defaultAdCostPct ||
      opVal !== ref.defaultOperatingCostPct ||
      packVal !== ref.defaultPackagingCost ||
      chFeeVal / 100 !== ref.defaultChannelFeePct ||
      shipVal !== ref.defaultShippingCost ||
      autoChannelFee !== ref.autoApplyChannelFee ||
      autoAdCost !== ref.autoApplyAdCost ||
      autoShipping !== ref.autoApplyShipping ||
      retRateVal / 100 !== ref.defaultReturnRate ||
      retShipVal !== ref.defaultReturnShipping ||
      smGoodVal / 100 !== ref.selfMallTargetGood ||
      smFairVal / 100 !== ref.selfMallTargetFair ||
      plGoodVal / 100 !== ref.platformTargetGood ||
      plFairVal / 100 !== ref.platformTargetFair ||
      minMgnVal / 100 !== ref.minimumAcceptableMargin)

  // ── 저장 ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!allValid) {
      toast.error('모든 항목에 유효한 숫자를 입력해 주세요')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/sh/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultAdCostPct: adVal,
          defaultOperatingCostPct: opVal,
          defaultPackagingCost: packVal,
          // % → 0~1 변환
          defaultChannelFeePct: chFeeVal / 100,
          defaultShippingCost: shipVal,
          defaultReturnRate: retRateVal / 100,
          defaultReturnShipping: retShipVal,
          autoApplyChannelFee: autoChannelFee,
          autoApplyAdCost: autoAdCost,
          autoApplyShipping: autoShipping,
          // % → 0~1 변환
          selfMallTargetGood: smGoodVal / 100,
          selfMallTargetFair: smFairVal / 100,
          platformTargetGood: plGoodVal / 100,
          platformTargetFair: plFairVal / 100,
          minimumAcceptableMargin: minMgnVal / 100,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? '저장 실패')

      const s = data.settings ?? data

      // 서버 응답값으로 기준점 갱신 (Decimal → number 방어 변환)
      const saved: PricingFullSettings = {
        defaultAdCostPct: Number(s.defaultAdCostPct ?? adVal),
        defaultOperatingCostPct: Number(s.defaultOperatingCostPct ?? opVal),
        defaultPackagingCost: Number(s.defaultPackagingCost ?? packVal),
        defaultChannelFeePct: Number(s.defaultChannelFeePct ?? chFeeVal / 100),
        defaultShippingCost: Number(s.defaultShippingCost ?? shipVal),
        autoApplyChannelFee: Boolean(s.autoApplyChannelFee ?? autoChannelFee),
        autoApplyAdCost: Boolean(s.autoApplyAdCost ?? autoAdCost),
        autoApplyShipping: Boolean(s.autoApplyShipping ?? autoShipping),
        defaultReturnRate: Number(s.defaultReturnRate ?? retRateVal / 100),
        defaultReturnShipping: Number(s.defaultReturnShipping ?? retShipVal),
        selfMallTargetGood: Number(s.selfMallTargetGood ?? smGoodVal / 100),
        selfMallTargetFair: Number(s.selfMallTargetFair ?? smFairVal / 100),
        platformTargetGood: Number(s.platformTargetGood ?? plGoodVal / 100),
        platformTargetFair: Number(s.platformTargetFair ?? plFairVal / 100),
        minimumAcceptableMargin: Number(s.minimumAcceptableMargin ?? minMgnVal / 100),
      }

      savedRef.current = saved
      // 서버 정규화 값으로 input도 업데이트
      Promise.resolve().then(() => {
        setAdCost(String(saved.defaultAdCostPct))
        setOpCost(String(saved.defaultOperatingCostPct))
        setPackCost(String(saved.defaultPackagingCost))
        setChannelFeePct(String(saved.defaultChannelFeePct * 100))
        setShippingCost(String(saved.defaultShippingCost))
        setAutoChannelFee(saved.autoApplyChannelFee)
        setAutoAdCost(saved.autoApplyAdCost)
        setAutoShipping(saved.autoApplyShipping)
        setReturnRate(String(saved.defaultReturnRate * 100))
        setReturnShipping(String(saved.defaultReturnShipping))
        setSelfMallGood(String(saved.selfMallTargetGood * 100))
        setSelfMallFair(String(saved.selfMallTargetFair * 100))
        setPlatformGood(String(saved.platformTargetGood * 100))
        setPlatformFair(String(saved.platformTargetFair * 100))
        setMinMargin(String(saved.minimumAcceptableMargin * 100))
      })

      toast.success('기본값이 저장되었습니다')
      onSaved?.(saved)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // ── 렌더 ───────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            기본값 설정
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic" className="text-xs">
              기본 비용
            </TabsTrigger>
            <TabsTrigger value="channel" className="text-xs">
              채널 및 배송
            </TabsTrigger>
            <TabsTrigger value="return" className="text-xs">
              반품 / 교환
            </TabsTrigger>
            <TabsTrigger value="margin" className="text-xs">
              마진 등급
            </TabsTrigger>
          </TabsList>

          {/* ── 탭 1: 기본 비용 ── */}
          <TabsContent value="basic" className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={adId} className="text-xs">
                광고비 (%)
              </Label>
              <SuffixInput
                id={adId}
                value={adCost}
                onChange={setAdCost}
                suffix="%"
                min={0}
                max={100}
                step={0.1}
                placeholder="10"
                dirty={!isNaN(adVal) && adVal !== ref.defaultAdCostPct}
              />
              <p className="text-xs text-muted-foreground">
                채널 광고비, 프로모션 비용을 매출 대비 퍼센트로 설정
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={opId} className="text-xs">
                운영비 (%)
              </Label>
              <SuffixInput
                id={opId}
                value={opCost}
                onChange={setOpCost}
                suffix="%"
                min={0}
                max={100}
                step={0.1}
                placeholder="5"
                dirty={!isNaN(opVal) && opVal !== ref.defaultOperatingCostPct}
              />
              <p className="text-xs text-muted-foreground">
                인건비, 임대료 등 운영비를 매출 대비 퍼센트로 설정
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={packId} className="text-xs">
                포장비 (원/건)
              </Label>
              <SuffixInput
                id={packId}
                value={packCost}
                onChange={setPackCost}
                suffix="₩"
                min={0}
                step={1}
                placeholder="500"
                dirty={!isNaN(packVal) && packVal !== ref.defaultPackagingCost}
              />
              <p className="text-xs text-muted-foreground">
                1건당 포장 재료비 (박스, 테이프, 완충재 등)
              </p>
            </div>
          </TabsContent>

          {/* ── 탭 2: 채널 및 배송 ── */}
          <TabsContent value="channel" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={chFeeId} className="text-xs">
                  채널 수수료율 (%)
                </Label>
                <SuffixInput
                  id={chFeeId}
                  value={channelFeePct}
                  onChange={setChannelFeePct}
                  suffix="%"
                  min={0}
                  max={100}
                  step={0.01}
                  placeholder="10.8"
                  dirty={!isNaN(chFeeVal) && chFeeVal / 100 !== ref.defaultChannelFeePct}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={shipId} className="text-xs">
                  배송비 (원)
                </Label>
                <SuffixInput
                  id={shipId}
                  value={shippingCost}
                  onChange={setShippingCost}
                  suffix="₩"
                  min={0}
                  step={100}
                  placeholder="3000"
                  dirty={!isNaN(shipVal) && shipVal !== ref.defaultShippingCost}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor={autoChId} className="text-xs">
                    채널 수수료 자동 적용
                  </Label>
                  <p className="text-xs text-muted-foreground">시뮬레이션 생성 시 자동 채움</p>
                </div>
                <Switch
                  id={autoChId}
                  checked={autoChannelFee}
                  onCheckedChange={setAutoChannelFee}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor={autoAdId} className="text-xs">
                    광고비 자동 적용
                  </Label>
                  <p className="text-xs text-muted-foreground">시뮬레이션 생성 시 자동 채움</p>
                </div>
                <Switch id={autoAdId} checked={autoAdCost} onCheckedChange={setAutoAdCost} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor={autoShipId} className="text-xs">
                    배송비 자동 적용
                  </Label>
                  <p className="text-xs text-muted-foreground">시뮬레이션 생성 시 자동 채움</p>
                </div>
                <Switch id={autoShipId} checked={autoShipping} onCheckedChange={setAutoShipping} />
              </div>
            </div>
          </TabsContent>

          {/* ── 탭 3: 반품 / 교환 ── */}
          <TabsContent value="return" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={retRateId} className="text-xs">
                  반품율 (%)
                </Label>
                <SuffixInput
                  id={retRateId}
                  value={returnRate}
                  onChange={setReturnRate}
                  suffix="%"
                  min={0}
                  max={100}
                  step={0.1}
                  placeholder="2.0"
                  dirty={!isNaN(retRateVal) && retRateVal / 100 !== ref.defaultReturnRate}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={retShipId} className="text-xs">
                  반품 배송비 (원)
                </Label>
                <SuffixInput
                  id={retShipId}
                  value={returnShipping}
                  onChange={setReturnShipping}
                  suffix="₩"
                  min={0}
                  step={100}
                  placeholder="5000"
                  dirty={!isNaN(retShipVal) && retShipVal !== ref.defaultReturnShipping}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              반품율은 전체 주문 대비 반품 비율. 순수익 계산 시 반품 손실 자동 반영.
            </p>
          </TabsContent>

          {/* ── 탭 4: 마진 등급 ── */}
          <TabsContent value="margin" className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              자사몰(SELF_MALL)과 플랫폼몰(오픈마켓·백화점·SNS 등) 기준으로 마진 등급을 분류합니다.
            </p>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">자사몰</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={smGoodId} className="text-xs">
                    높음 임계 (%)
                  </Label>
                  <SuffixInput
                    id={smGoodId}
                    value={selfMallGood}
                    onChange={setSelfMallGood}
                    suffix="%"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="35"
                    dirty={!isNaN(smGoodVal) && smGoodVal / 100 !== ref.selfMallTargetGood}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={smFairId} className="text-xs">
                    적합 하한 (%)
                  </Label>
                  <SuffixInput
                    id={smFairId}
                    value={selfMallFair}
                    onChange={setSelfMallFair}
                    suffix="%"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="25"
                    dirty={!isNaN(smFairVal) && smFairVal / 100 !== ref.selfMallTargetFair}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">플랫폼몰</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={plGoodId} className="text-xs">
                    높음 임계 (%)
                  </Label>
                  <SuffixInput
                    id={plGoodId}
                    value={platformGood}
                    onChange={setPlatformGood}
                    suffix="%"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="25"
                    dirty={!isNaN(plGoodVal) && plGoodVal / 100 !== ref.platformTargetGood}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={plFairId} className="text-xs">
                    적합 하한 (%)
                  </Label>
                  <SuffixInput
                    id={plFairId}
                    value={platformFair}
                    onChange={setPlatformFair}
                    suffix="%"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="15"
                    dirty={!isNaN(plFairVal) && plFairVal / 100 !== ref.platformTargetFair}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={minMgnId} className="text-xs">
                최소 허용 마진 (%)
              </Label>
              <SuffixInput
                id={minMgnId}
                value={minMargin}
                onChange={setMinMargin}
                suffix="%"
                min={0}
                max={100}
                step={0.1}
                placeholder="10"
                dirty={!isNaN(minMgnVal) && minMgnVal / 100 !== ref.minimumAcceptableMargin}
              />
              <p className="text-xs text-muted-foreground">
                할인 한계 계산 시 기준이 되는 최소 마진율입니다.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={saving}
          >
            취소
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || saving}
            aria-label="기본값 저장"
          >
            {saving ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
