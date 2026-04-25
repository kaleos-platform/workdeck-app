'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type PricingSettings = {
  id: string
  // 기존 — 0~100 % 단위
  defaultOperatingCostPct: number
  defaultAdCostPct: number
  defaultPackagingCost: number
  // 신규 — 0~1 비율 단위 (UI에서는 % 변환해 표시)
  defaultChannelFeePct: number
  defaultShippingCost: number
  defaultReturnRate: number
  defaultReturnShipping: number
  autoApplyChannelFee: boolean
  autoApplyAdCost: boolean
  autoApplyShipping: boolean
  // 마진 등급 임계값 — 0~1 비율 단위
  selfMallTargetGood: number
  selfMallTargetFair: number
  platformTargetGood: number
  platformTargetFair: number
  minimumAcceptableMargin: number
}

export function PricingSettingsForm() {
  const [settings, setSettings] = useState<PricingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 기존 편집 상태
  const [opCost, setOpCost] = useState('')
  const [adCost, setAdCost] = useState('')
  const [packCost, setPackCost] = useState('')

  // 신규 편집 상태 (수수료율/반품율은 % 단위로 표시)
  const [channelFeePct, setChannelFeePct] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [returnRate, setReturnRate] = useState('')
  const [returnShipping, setReturnShipping] = useState('')
  const [autoChannelFee, setAutoChannelFee] = useState(false)
  const [autoAdCost, setAutoAdCost] = useState(false)
  const [autoShipping, setAutoShipping] = useState(false)

  // 마진 등급 임계값 편집 상태 (% 단위로 표시)
  const [selfMallGood, setSelfMallGood] = useState('')
  const [selfMallFair, setSelfMallFair] = useState('')
  const [platformGood, setPlatformGood] = useState('')
  const [platformFair, setPlatformFair] = useState('')
  const [minMargin, setMinMargin] = useState('')

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sh/settings')
      if (!res.ok) return
      const data = await res.json()
      const s: PricingSettings = data.settings ?? data
      if (s?.id) {
        setSettings(s)
        setOpCost(String(s.defaultOperatingCostPct))
        setAdCost(String(s.defaultAdCostPct))
        setPackCost(String(s.defaultPackagingCost))
        // 0~1 → % 변환
        setChannelFeePct(String(s.defaultChannelFeePct * 100))
        setShippingCost(String(s.defaultShippingCost))
        setReturnRate(String(s.defaultReturnRate * 100))
        setReturnShipping(String(s.defaultReturnShipping))
        setAutoChannelFee(s.autoApplyChannelFee)
        setAutoAdCost(s.autoApplyAdCost)
        setAutoShipping(s.autoApplyShipping)
        // 0~1 → % 변환
        setSelfMallGood(String((s.selfMallTargetGood ?? 0.35) * 100))
        setSelfMallFair(String((s.selfMallTargetFair ?? 0.25) * 100))
        setPlatformGood(String((s.platformTargetGood ?? 0.25) * 100))
        setPlatformFair(String((s.platformTargetFair ?? 0.15) * 100))
        setMinMargin(String((s.minimumAcceptableMargin ?? 0.1) * 100))
      }
    } catch {
      // 설정 없으면 기본값
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  async function handleSave() {
    const opVal = parseFloat(opCost)
    const adVal = parseFloat(adCost)
    const packVal = parseFloat(packCost)
    const chFeeVal = parseFloat(channelFeePct)
    const shipVal = parseFloat(shippingCost)
    const retRateVal = parseFloat(returnRate)
    const retShipVal = parseFloat(returnShipping)
    const selfMallGoodVal = parseFloat(selfMallGood)
    const selfMallFairVal = parseFloat(selfMallFair)
    const platformGoodVal = parseFloat(platformGood)
    const platformFairVal = parseFloat(platformFair)
    const minMarginVal = parseFloat(minMargin)

    if (
      isNaN(opVal) ||
      isNaN(adVal) ||
      isNaN(packVal) ||
      isNaN(chFeeVal) ||
      isNaN(shipVal) ||
      isNaN(retRateVal) ||
      isNaN(retShipVal) ||
      isNaN(selfMallGoodVal) ||
      isNaN(selfMallFairVal) ||
      isNaN(platformGoodVal) ||
      isNaN(platformFairVal) ||
      isNaN(minMarginVal)
    ) {
      toast.error('모든 항목에 유효한 숫자를 입력해 주세요')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/sh/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultOperatingCostPct: opVal,
          defaultAdCostPct: adVal,
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
          selfMallTargetGood: selfMallGoodVal / 100,
          selfMallTargetFair: selfMallFairVal / 100,
          platformTargetGood: platformGoodVal / 100,
          platformTargetFair: platformFairVal / 100,
          minimumAcceptableMargin: minMarginVal / 100,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success('설정이 저장되었습니다')
      await loadSettings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>가격 시뮬레이션 기본값</CardTitle>
        <CardDescription>
          가격 시뮬레이션에서 사용할 기본 비용 설정입니다. 개별 시나리오에서 재정의가 가능합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : (
          <div className="space-y-6">
            {/* ── 기본 비용 ── */}
            <div className="space-y-4">
              <p className="text-sm font-medium">기본 비용</p>

              <div className="space-y-2">
                <Label htmlFor="op-cost">운영비 비율 (%)</Label>
                <Input
                  id="op-cost"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={opCost}
                  onChange={(e) => setOpCost(e.target.value)}
                  placeholder="예: 5.0"
                />
                <p className="text-xs text-muted-foreground">
                  인건비, 임대료 등 운영비를 매출 대비 퍼센트로 설정
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ad-cost">광고비 비율 (%)</Label>
                <Input
                  id="ad-cost"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={adCost}
                  onChange={(e) => setAdCost(e.target.value)}
                  placeholder="예: 10.0"
                />
                <p className="text-xs text-muted-foreground">
                  채널 광고비, 프로모션 비용을 매출 대비 퍼센트로 설정
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pack-cost">포장비 (원/건)</Label>
                <Input
                  id="pack-cost"
                  type="number"
                  min="0"
                  step="1"
                  value={packCost}
                  onChange={(e) => setPackCost(e.target.value)}
                  placeholder="예: 500"
                />
                <p className="text-xs text-muted-foreground">
                  1건당 포장 재료비 (박스, 테이프, 완충재 등)
                </p>
              </div>
            </div>

            {/* ── 채널 및 배송 ── */}
            <div className="space-y-4">
              <p className="text-sm font-medium">채널 및 배송</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="channel-fee-pct">채널 수수료율 (%)</Label>
                  <Input
                    id="channel-fee-pct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={channelFeePct}
                    onChange={(e) => setChannelFeePct(e.target.value)}
                    placeholder="예: 10.8"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping-cost">배송비 (원)</Label>
                  <Input
                    id="shipping-cost"
                    type="number"
                    min="0"
                    step="100"
                    value={shippingCost}
                    onChange={(e) => setShippingCost(e.target.value)}
                    placeholder="예: 3000"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="auto-channel-fee">채널 수수료 자동 적용</Label>
                    <p className="text-xs text-muted-foreground">시뮬레이션 생성 시 자동 채움</p>
                  </div>
                  <Switch
                    id="auto-channel-fee"
                    checked={autoChannelFee}
                    onCheckedChange={setAutoChannelFee}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="auto-ad-cost">광고비 자동 적용</Label>
                    <p className="text-xs text-muted-foreground">시뮬레이션 생성 시 자동 채움</p>
                  </div>
                  <Switch id="auto-ad-cost" checked={autoAdCost} onCheckedChange={setAutoAdCost} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="auto-shipping">배송비 자동 적용</Label>
                    <p className="text-xs text-muted-foreground">시뮬레이션 생성 시 자동 채움</p>
                  </div>
                  <Switch
                    id="auto-shipping"
                    checked={autoShipping}
                    onCheckedChange={setAutoShipping}
                  />
                </div>
              </div>
            </div>

            {/* ── 반품/교환 ── */}
            <div className="space-y-4">
              <p className="text-sm font-medium">반품 / 교환</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="return-rate">반품율 (%)</Label>
                  <Input
                    id="return-rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={returnRate}
                    onChange={(e) => setReturnRate(e.target.value)}
                    placeholder="예: 2.0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="return-shipping">반품 배송비 (원)</Label>
                  <Input
                    id="return-shipping"
                    type="number"
                    min="0"
                    step="100"
                    value={returnShipping}
                    onChange={(e) => setReturnShipping(e.target.value)}
                    placeholder="예: 5000"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                반품율은 전체 주문 대비 반품 비율. 순수익 계산 시 반품 손실 자동 반영.
              </p>
            </div>

            {/* ── 마진 등급 임계값 ── */}
            <div className="space-y-4">
              <p className="text-sm font-medium">마진 등급 임계값</p>
              <p className="text-xs text-muted-foreground">
                자사몰(SELF_MALL)과 플랫폼몰(오픈마켓·백화점·SNS 등) 기준으로 마진 등급을
                분류합니다.
              </p>

              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">자사몰</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="self-mall-good">높음 임계 (%)</Label>
                    <Input
                      id="self-mall-good"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={selfMallGood}
                      onChange={(e) => setSelfMallGood(e.target.value)}
                      placeholder="예: 35"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="self-mall-fair">적합 하한 (%)</Label>
                    <Input
                      id="self-mall-fair"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={selfMallFair}
                      onChange={(e) => setSelfMallFair(e.target.value)}
                      placeholder="예: 25"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">플랫폼몰</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="platform-good">높음 임계 (%)</Label>
                    <Input
                      id="platform-good"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={platformGood}
                      onChange={(e) => setPlatformGood(e.target.value)}
                      placeholder="예: 25"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="platform-fair">적합 하한 (%)</Label>
                    <Input
                      id="platform-fair"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={platformFair}
                      onChange={(e) => setPlatformFair(e.target.value)}
                      placeholder="예: 15"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="min-margin">최소 허용 마진 (%)</Label>
                <Input
                  id="min-margin"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={minMargin}
                  onChange={(e) => setMinMargin(e.target.value)}
                  placeholder="예: 10"
                />
                <p className="text-xs text-muted-foreground">
                  할인 한계 계산 시 기준이 되는 최소 마진율입니다.
                </p>
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving || !settings} className="w-full">
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
