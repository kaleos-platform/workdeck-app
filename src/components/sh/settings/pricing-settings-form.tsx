'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type PricingSettings = {
  id: string
  defaultOperatingCostPct: number
  defaultAdCostPct: number
  defaultPackagingCost: number
}

export function PricingSettingsForm() {
  const [settings, setSettings] = useState<PricingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 편집 상태
  const [opCost, setOpCost] = useState('')
  const [adCost, setAdCost] = useState('')
  const [packCost, setPackCost] = useState('')

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

    if (isNaN(opVal) || isNaN(adVal) || isNaN(packVal)) {
      toast.error('모든 항목에 유효한 숫자를 입력해 주세요')
      return
    }

    setSaving(true)
    try {
      const method = settings ? 'PATCH' : 'POST'
      const res = await fetch('/api/sh/settings', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultOperatingCostPct: opVal,
          defaultAdCostPct: adVal,
          defaultPackagingCost: packVal,
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
          Phase 2 가격 시뮬레이션에서 사용할 기본 비용 설정입니다. 실제 시뮬레이션에서 개별 재정의가
          가능합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="op-cost">기본 운영비 비율 (%)</Label>
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
              <Label htmlFor="ad-cost">기본 광고비 비율 (%)</Label>
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
              <Label htmlFor="pack-cost">기본 포장비 (원/건)</Label>
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

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
