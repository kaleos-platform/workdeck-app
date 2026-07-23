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

export type PricingFullSettings = {
  // ⚠️ 단위 혼재 주의:
  //   defaultAdCostPct · defaultOperatingCostPct 는 0~100 단위로 DB 저장.
  //   아래 defaultChannelFeePct 등 나머지 비율 필드는 0~1 단위.
  //   이 두 필드를 직접 계산에 사용할 때는 반드시 /100 변환 필요.
  //   변환 예시: liveFromSettings() — adCostPct: s.defaultAdCostPct / 100
  //
  // ⚠️ 이 다이얼로그는 일부 필드(ad/operating/channelFee/shipping/auto*)를 더는 편집하지 않는다.
  //   광고비는 채널별 설정(Channel.adCostPct)으로, 채널수수료율·배송비는 채널 설정이 소스,
  //   운영비·자동적용 토글은 계산 미반영(레거시)이라 UI에서 제거됨.
  //   단 값은 savedRef를 통해 그대로 통과 저장한다(API/Zod 15필드 계약 유지).
  defaultOperatingCostPct: number
  defaultAdCostPct: number
  defaultPackagingCost: number
  // 채널 및 배송 (0~1 단위 DB 저장) — UI 미편집, 통과 저장
  defaultChannelFeePct: number
  defaultShippingCost: number
  autoApplyChannelFee: boolean
  autoApplyAdCost: boolean
  autoApplyShipping: boolean
  // 반품 / 교환
  defaultReturnRate: number
  defaultReturnShipping: number
  // VAT (0~1 단위 DB 저장)
  defaultIncludeVat: boolean
  defaultVatRate: number
  // 마진 등급 임계값 (0~1 단위 DB 저장, UI에서 % 표시) — 단일 기준
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
  // 반품 / 교환
  const retRateId = useId()
  const retShipId = useId()

  // VAT
  const incVatId = useId()
  const vatRateId = useId()

  // 마진 등급
  const plGoodId = useId()
  const plFairId = useId()
  const minMgnId = useId()

  // 저장 완료 기준점 (dirty 체크용 + 미편집 필드 통과 저장 소스)
  const savedRef = useRef<PricingFullSettings>(initialSettings)

  // ── 편집 상태 (편집 가능한 필드만) ─────────────────────────────────────────

  // 반품 / 교환 (0~1 → % 표시)
  const [returnRate, setReturnRate] = useState(String(initialSettings.defaultReturnRate * 100))
  const [returnShipping, setReturnShipping] = useState(
    String(initialSettings.defaultReturnShipping)
  )

  // VAT (vatRate 0~1 → % 표시)
  const [includeVat, setIncludeVat] = useState(initialSettings.defaultIncludeVat)
  const [vatRate, setVatRate] = useState(String(initialSettings.defaultVatRate * 100))

  // 마진 등급 (0~1 → % 표시)
  const [platformGood, setPlatformGood] = useState(String(initialSettings.platformTargetGood * 100))
  const [platformFair, setPlatformFair] = useState(String(initialSettings.platformTargetFair * 100))
  const [minMargin, setMinMargin] = useState(String(initialSettings.minimumAcceptableMargin * 100))

  const [saving, setSaving] = useState(false)

  // ── initialSettings 외부 변경 시 동기화 ────────────────────────────────────

  useEffect(() => {
    const s = initialSettings
    setReturnRate(String(s.defaultReturnRate * 100))
    setReturnShipping(String(s.defaultReturnShipping))
    setIncludeVat(s.defaultIncludeVat)
    setVatRate(String(s.defaultVatRate * 100))
    setPlatformGood(String(s.platformTargetGood * 100))
    setPlatformFair(String(s.platformTargetFair * 100))
    setMinMargin(String(s.minimumAcceptableMargin * 100))
    savedRef.current = s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialSettings.defaultReturnRate,
    initialSettings.defaultReturnShipping,
    initialSettings.defaultIncludeVat,
    initialSettings.defaultVatRate,
    initialSettings.platformTargetGood,
    initialSettings.platformTargetFair,
    initialSettings.minimumAcceptableMargin,
  ])

  // ── Dialog 닫힐 때 미저장 변경사항 리셋 ───────────────────────────────────

  function resetToSaved() {
    const s = savedRef.current
    setReturnRate(String(s.defaultReturnRate * 100))
    setReturnShipping(String(s.defaultReturnShipping))
    setIncludeVat(s.defaultIncludeVat)
    setVatRate(String(s.defaultVatRate * 100))
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

  const retRateVal = parseFloat(returnRate)
  const retShipVal = parseFloat(returnShipping)
  const vatRateVal = parseFloat(vatRate)
  const plGoodVal = parseFloat(platformGood)
  const plFairVal = parseFloat(platformFair)
  const minMgnVal = parseFloat(minMargin)

  const allValid =
    !isNaN(retRateVal) &&
    !isNaN(retShipVal) &&
    !isNaN(vatRateVal) &&
    !isNaN(plGoodVal) &&
    !isNaN(plFairVal) &&
    !isNaN(minMgnVal)

  const ref = savedRef.current
  const isDirty =
    allValid &&
    (retRateVal / 100 !== ref.defaultReturnRate ||
      retShipVal !== ref.defaultReturnShipping ||
      includeVat !== ref.defaultIncludeVat ||
      vatRateVal / 100 !== ref.defaultVatRate ||
      plGoodVal / 100 !== ref.platformTargetGood ||
      plFairVal / 100 !== ref.platformTargetFair ||
      minMgnVal / 100 !== ref.minimumAcceptableMargin)

  // ── 저장 ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!allValid) {
      toast.error('모든 항목에 유효한 숫자를 입력해 주세요')
      return
    }
    if (plFairVal > plGoodVal) {
      toast.error('적합 하한은 높음 임계보다 작아야 합니다')
      return
    }

    setSaving(true)
    try {
      // 미편집 필드(광고비·운영비·채널수수료율·배송비·자동적용 토글)는 savedRef 값을 그대로 통과
      // — API/Zod는 15필드 전체를 요구하므로 누락 금지.
      const prev = savedRef.current
      const res = await fetch('/api/sh/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultAdCostPct: prev.defaultAdCostPct,
          defaultOperatingCostPct: prev.defaultOperatingCostPct,
          defaultPackagingCost: prev.defaultPackagingCost,
          defaultChannelFeePct: prev.defaultChannelFeePct,
          defaultShippingCost: prev.defaultShippingCost,
          defaultReturnRate: retRateVal / 100,
          defaultReturnShipping: retShipVal,
          defaultIncludeVat: includeVat,
          defaultVatRate: vatRateVal / 100,
          autoApplyChannelFee: prev.autoApplyChannelFee,
          autoApplyAdCost: prev.autoApplyAdCost,
          autoApplyShipping: prev.autoApplyShipping,
          platformTargetGood: plGoodVal / 100,
          platformTargetFair: plFairVal / 100,
          minimumAcceptableMargin: minMgnVal / 100,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? '저장 실패')

      const s = data.settings ?? data

      const saved: PricingFullSettings = {
        defaultAdCostPct: Number(s.defaultAdCostPct ?? prev.defaultAdCostPct),
        defaultOperatingCostPct: Number(s.defaultOperatingCostPct ?? prev.defaultOperatingCostPct),
        defaultPackagingCost: Number(s.defaultPackagingCost ?? prev.defaultPackagingCost),
        defaultChannelFeePct: Number(s.defaultChannelFeePct ?? prev.defaultChannelFeePct),
        defaultShippingCost: Number(s.defaultShippingCost ?? prev.defaultShippingCost),
        autoApplyChannelFee: Boolean(s.autoApplyChannelFee ?? prev.autoApplyChannelFee),
        autoApplyAdCost: Boolean(s.autoApplyAdCost ?? prev.autoApplyAdCost),
        autoApplyShipping: Boolean(s.autoApplyShipping ?? prev.autoApplyShipping),
        defaultReturnRate: Number(s.defaultReturnRate ?? retRateVal / 100),
        defaultReturnShipping: Number(s.defaultReturnShipping ?? retShipVal),
        defaultIncludeVat: Boolean(s.defaultIncludeVat ?? includeVat),
        defaultVatRate: Number(s.defaultVatRate ?? vatRateVal / 100),
        platformTargetGood: Number(s.platformTargetGood ?? plGoodVal / 100),
        platformTargetFair: Number(s.platformTargetFair ?? plFairVal / 100),
        minimumAcceptableMargin: Number(s.minimumAcceptableMargin ?? minMgnVal / 100),
      }

      savedRef.current = saved
      Promise.resolve().then(() => {
        setReturnRate(String(saved.defaultReturnRate * 100))
        setReturnShipping(String(saved.defaultReturnShipping))
        setIncludeVat(saved.defaultIncludeVat)
        setVatRate(String(saved.defaultVatRate * 100))
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic" className="text-xs">
              반품 · VAT
            </TabsTrigger>
            <TabsTrigger value="margin" className="text-xs">
              마진 등급
            </TabsTrigger>
          </TabsList>

          {/* ── 탭 1: 반품 · VAT ── */}
          <TabsContent value="basic" className="mt-4 space-y-4">
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

            {/* VAT */}
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor={incVatId} className="text-xs">
                    VAT 포함
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    판매가에 VAT가 포함된 경우 매출에서 제외하고 계산
                  </p>
                </div>
                <Switch id={incVatId} checked={includeVat} onCheckedChange={setIncludeVat} />
              </div>
              {includeVat && (
                <div className="space-y-1.5">
                  <Label htmlFor={vatRateId} className="text-xs">
                    VAT 율 (%)
                  </Label>
                  <SuffixInput
                    id={vatRateId}
                    value={vatRate}
                    onChange={setVatRate}
                    suffix="%"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="10"
                    dirty={!isNaN(vatRateVal) && vatRateVal / 100 !== ref.defaultVatRate}
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              채널 수수료율·배송비·광고비는 채널 설정(채널 관리 → 채널 수정)에서 채널별로
              관리합니다.
            </p>
          </TabsContent>

          {/* ── 탭 2: 마진 등급 ── */}
          <TabsContent value="margin" className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              마진율을 등급으로 분류하는 임계값입니다. 모든 채널에 동일하게 적용됩니다.
            </p>

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
                <p className="text-xs text-muted-foreground">
                  이 값 이상이면 &lsquo;높음&rsquo; 등급
                </p>
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
                <p className="text-xs text-muted-foreground">
                  이 값 미만이면 &lsquo;낮음&rsquo; 등급
                </p>
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
