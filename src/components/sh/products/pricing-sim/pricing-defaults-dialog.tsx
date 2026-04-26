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
import { cn } from '@/lib/utils'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export type DefaultSettings = {
  defaultOperatingCostPct: number
  defaultAdCostPct: number
  defaultPackagingCost: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 부모에서 이미 로드한 초기값 */
  initialDefaults: DefaultSettings
  /** 저장 완료 후 부모에게 최신 값 전달 */
  onSaved?: (settings: DefaultSettings) => void
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function PricingDefaultsDialog({ open, onOpenChange, initialDefaults, onSaved }: Props) {
  const adId = useId()
  const opId = useId()
  const packId = useId()

  // 저장 완료 기준점 (dirty 체크용)
  const savedRef = useRef<DefaultSettings>(initialDefaults)

  // 편집 중인 string 값 — Dialog가 열릴 때마다 최신 saved 값으로 초기화
  const [adCost, setAdCost] = useState(String(initialDefaults.defaultAdCostPct))
  const [opCost, setOpCost] = useState(String(initialDefaults.defaultOperatingCostPct))
  const [packCost, setPackCost] = useState(String(initialDefaults.defaultPackagingCost))

  const [saving, setSaving] = useState(false)

  // initialDefaults가 바뀌면 (부모 로드 완료 후) 편집 상태 동기화
  useEffect(() => {
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

  // Dialog 닫힐 때 unsaved 변경사항 버리기 — saved 기준점으로 리셋
  function handleOpenChange(next: boolean) {
    if (!next) {
      // 저장 안 된 변경사항 초기화
      Promise.resolve().then(() => {
        setAdCost(String(savedRef.current.defaultAdCostPct))
        setOpCost(String(savedRef.current.defaultOperatingCostPct))
        setPackCost(String(savedRef.current.defaultPackagingCost))
      })
    }
    onOpenChange(next)
  }

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
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            기본값 설정
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
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
                  !isNaN(adVal) && adVal !== savedRef.current.defaultAdCostPct && 'border-amber-400'
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
