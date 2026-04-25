'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export type DefaultSettings = {
  defaultOperatingCostPct: number
  defaultAdCostPct: number
  defaultPackagingCost: number
}

type Props = {
  /** 부모에서 이미 로드한 초기값 (중복 GET 방지) */
  initialDefaults: DefaultSettings
  /** 저장 완료 후 부모에게 최신 값 전달 */
  onSaved?: (settings: DefaultSettings) => void
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function PricingDefaultsCard({ initialDefaults, onSaved }: Props) {
  const adId = useId()
  const opId = useId()
  const packId = useId()

  // 펼침/접힘 (기본: 접힘)
  const [open, setOpen] = useState(false)

  // 저장 완료 기준점 (dirty 체크용) — initialDefaults로 시작
  const savedRef = useRef<DefaultSettings>(initialDefaults)

  // 편집 중인 string 값
  const [adCost, setAdCost] = useState(String(initialDefaults.defaultAdCostPct))
  const [opCost, setOpCost] = useState(String(initialDefaults.defaultOperatingCostPct))
  const [packCost, setPackCost] = useState(String(initialDefaults.defaultPackagingCost))

  const [saving, setSaving] = useState(false)

  // initialDefaults가 바뀌면 (부모 로드 완료 후) 편집 상태 동기화
  useEffect(() => {
    // 아직 저장 중이 아닐 때만 덮어쓴다
    setAdCost(String(initialDefaults.defaultAdCostPct))
    setOpCost(String(initialDefaults.defaultOperatingCostPct))
    setPackCost(String(initialDefaults.defaultPackagingCost))
    savedRef.current = initialDefaults
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialDefaults.defaultAdCostPct,
    initialDefaults.defaultOperatingCostPct,
    initialDefaults.defaultPackagingCost,
  ])

  // ── dirty 체크 ─────────────────────────────────────────────────────────────

  const adVal = parseFloat(adCost)
  const opVal = parseFloat(opCost)
  const packVal = parseFloat(packCost)

  const allValid = !isNaN(adVal) && !isNaN(opVal) && !isNaN(packVal)

  const isDirty =
    allValid &&
    (adVal !== savedRef.current.defaultAdCostPct ||
      opVal !== savedRef.current.defaultOperatingCostPct ||
      packVal !== savedRef.current.defaultPackagingCost)

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
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? '저장 실패')

      // 서버 응답값으로 기준점 갱신 (Decimal → number 방어 변환 유지)
      const saved: DefaultSettings = {
        defaultAdCostPct: Number(data.settings?.defaultAdCostPct ?? adVal),
        defaultOperatingCostPct: Number(data.settings?.defaultOperatingCostPct ?? opVal),
        defaultPackagingCost: Number(data.settings?.defaultPackagingCost ?? packVal),
      }

      savedRef.current = saved
      // 서버 정규화 값으로 input도 업데이트
      Promise.resolve().then(() => {
        setAdCost(String(saved.defaultAdCostPct))
        setOpCost(String(saved.defaultOperatingCostPct))
        setPackCost(String(saved.defaultPackagingCost))
      })

      toast.success('기본값이 저장되었습니다')
      onSaved?.(saved)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // ── 렌더 ───────────────────────────────────────────────────────────────────

  return (
    <Card>
      {/* 헤더 — 클릭으로 펼침/접힘 */}
      <CardHeader
        className="cursor-pointer pb-3 select-none"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">기본값 설정</CardTitle>
            {!open && (
              <span className="text-xs text-muted-foreground">
                광고비 {savedRef.current.defaultAdCostPct}% · 운영비{' '}
                {savedRef.current.defaultOperatingCostPct}% · 포장비{' '}
                {savedRef.current.defaultPackagingCost.toLocaleString('ko-KR')}원
              </span>
            )}
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CardHeader>

      {/* 폼 — 펼쳤을 때만 표시 */}
      {open && (
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {/* 광고비 % */}
            <div className="space-y-1.5">
              <Label htmlFor={adId} className="text-xs">
                광고비 (%)
              </Label>
              <div className="relative flex items-center">
                <Input
                  id={adId}
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={adCost}
                  onChange={(e) => setAdCost(e.target.value)}
                  className={cn(
                    'h-8 [appearance:textfield] pr-6 text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                    !isNaN(adVal) &&
                      adVal !== savedRef.current.defaultAdCostPct &&
                      'border-amber-400'
                  )}
                  placeholder="10"
                />
                <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </div>

            {/* 운영비 % */}
            <div className="space-y-1.5">
              <Label htmlFor={opId} className="text-xs">
                운영비 (%)
              </Label>
              <div className="relative flex items-center">
                <Input
                  id={opId}
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={opCost}
                  onChange={(e) => setOpCost(e.target.value)}
                  className={cn(
                    'h-8 [appearance:textfield] pr-6 text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                    !isNaN(opVal) &&
                      opVal !== savedRef.current.defaultOperatingCostPct &&
                      'border-amber-400'
                  )}
                  placeholder="5"
                />
                <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </div>

            {/* 포장비 원 */}
            <div className="space-y-1.5">
              <Label htmlFor={packId} className="text-xs">
                포장비 (원)
              </Label>
              <div className="relative flex items-center">
                <Input
                  id={packId}
                  type="number"
                  min={0}
                  step={1}
                  value={packCost}
                  onChange={(e) => setPackCost(e.target.value)}
                  className={cn(
                    'h-8 [appearance:textfield] pr-6 text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                    !isNaN(packVal) &&
                      packVal !== savedRef.current.defaultPackagingCost &&
                      'border-amber-400'
                  )}
                  placeholder="500"
                />
                <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
                  ₩
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || saving}
              aria-label="기본값 저장"
            >
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
