'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DEFAULT_GOOD = 0.25
const DEFAULT_FAIR = 0.15
const DEFAULT_MIN = 0.1

type Settings = {
  platformTargetGood: number
  platformTargetFair: number
  minimumAcceptableMargin: number
}

export function MarginTierSettingsCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [good, setGood] = useState('')
  const [fair, setFair] = useState('')
  const [min, setMin] = useState('')
  const savedRef = useRef<Settings>({
    platformTargetGood: DEFAULT_GOOD,
    platformTargetFair: DEFAULT_FAIR,
    minimumAcceptableMargin: DEFAULT_MIN,
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/sh/settings')
        if (!res.ok) throw new Error('설정 조회 실패')
        const data = await res.json()
        if (cancelled) return
        const s = data?.settings ?? {}
        const next: Settings = {
          platformTargetGood: Number(s.platformTargetGood ?? DEFAULT_GOOD),
          platformTargetFair: Number(s.platformTargetFair ?? DEFAULT_FAIR),
          minimumAcceptableMargin: Number(s.minimumAcceptableMargin ?? DEFAULT_MIN),
        }
        savedRef.current = next
        setGood(String(next.platformTargetGood * 100))
        setFair(String(next.platformTargetFair * 100))
        setMin(String(next.minimumAcceptableMargin * 100))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '설정 조회 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const goodVal = parseFloat(good)
  const fairVal = parseFloat(fair)
  const minVal = parseFloat(min)
  const allValid = !isNaN(goodVal) && !isNaN(fairVal) && !isNaN(minVal)

  const ref = savedRef.current
  const isDirty =
    allValid &&
    (goodVal / 100 !== ref.platformTargetGood ||
      fairVal / 100 !== ref.platformTargetFair ||
      minVal / 100 !== ref.minimumAcceptableMargin)

  function applyDefaults() {
    setGood(String(DEFAULT_GOOD * 100))
    setFair(String(DEFAULT_FAIR * 100))
    setMin(String(DEFAULT_MIN * 100))
  }

  async function handleSave() {
    if (!allValid) {
      toast.error('모든 항목에 유효한 숫자를 입력해 주세요')
      return
    }
    if (fairVal > goodVal) {
      toast.error('적합 하한은 높음 임계보다 작아야 합니다')
      return
    }
    if (minVal > fairVal) {
      toast.error('최소 허용 마진은 적합 하한보다 작거나 같아야 합니다')
      return
    }

    setSaving(true)
    try {
      // PUT은 전체 필드를 받으므로 GET으로 현재값 머지
      const cur = await fetch('/api/sh/settings').then((r) => r.json())
      const s = cur?.settings ?? {}
      const res = await fetch('/api/sh/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...s,
          platformTargetGood: goodVal / 100,
          platformTargetFair: fairVal / 100,
          minimumAcceptableMargin: minVal / 100,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')

      const saved = data.settings
      const next: Settings = {
        platformTargetGood: Number(saved.platformTargetGood),
        platformTargetFair: Number(saved.platformTargetFair),
        minimumAcceptableMargin: Number(saved.minimumAcceptableMargin),
      }
      savedRef.current = next
      setGood(String(next.platformTargetGood * 100))
      setFair(String(next.platformTargetFair * 100))
      setMin(String(next.minimumAcceptableMargin * 100))
      toast.success('마진 등급 기준이 저장되었습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>마진 등급 기준</CardTitle>
        <CardDescription>
          가격 시뮬레이션과 매트릭스에서 사용하는 마진율 등급 분류 임계값입니다. 모든 채널에
          동일하게 적용됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="mt-good" className="text-xs">
                  높음 임계 (%)
                </Label>
                <SuffixInput id="mt-good" value={good} onChange={setGood} suffix="%" />
                <p className="text-xs text-muted-foreground">이 값 이상이면 &lsquo;높음&rsquo;</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-fair" className="text-xs">
                  적합 하한 (%)
                </Label>
                <SuffixInput id="mt-fair" value={fair} onChange={setFair} suffix="%" />
                <p className="text-xs text-muted-foreground">이 값 미만이면 &lsquo;낮음&rsquo;</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-min" className="text-xs">
                  최소 허용 마진 (%)
                </Label>
                <SuffixInput id="mt-min" value={min} onChange={setMin} suffix="%" />
                <p className="text-xs text-muted-foreground">할인 한계 계산 기준</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={applyDefaults}
                disabled={saving}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                기본값 적용 (25 / 15 / 10)
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={!isDirty || saving}>
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                저장
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SuffixInput({
  id,
  value,
  onChange,
  suffix,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  suffix: string
}) {
  return (
    <div className="relative flex items-center">
      <Input
        id={id}
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 [appearance:textfield] pr-8 text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
        {suffix}
      </span>
    </div>
  )
}
