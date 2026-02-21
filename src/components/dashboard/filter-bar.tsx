'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RotateCcw } from 'lucide-react'

interface AdTypeOption {
  value: string
  label: string
}

interface FilterBarProps {
  adTypeOptions?: AdTypeOption[]
}

const DEFAULT_AD_TYPE_OPTIONS: AdTypeOption[] = [
  { value: 'all', label: '전체' },
  { value: '키워드 광고', label: '키워드 광고' },
  { value: '상품 광고', label: '상품 광고' },
]

// 오늘 날짜 문자열 (미래 날짜 방지용)
function getTodayStr(): string {
  return new Date().toISOString().split('T')[0]
}

export function FilterBar({ adTypeOptions = DEFAULT_AD_TYPE_OPTIONS }: FilterBarProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const adType = searchParams.get('adType') ?? 'all'
  const today = getTodayStr()

  function buildParams(overrides: Record<string, string>): string {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(overrides)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    return params.toString()
  }

  function handleFromChange(value: string) {
    // from이 미래 날짜면 오늘로 제한
    const clamped = value > today ? today : value
    // from이 to보다 크면 to를 from으로 맞춤
    const newTo = to && clamped > to ? clamped : to
    router.push(`${pathname}?${buildParams({ from: clamped, to: newTo })}`)
  }

  function handleToChange(value: string) {
    // to가 미래 날짜면 오늘로 제한
    const clamped = value > today ? today : value
    // to가 from보다 작으면 from을 to로 맞춤
    const newFrom = from && clamped < from ? clamped : from
    router.push(`${pathname}?${buildParams({ from: newFrom, to: clamped })}`)
  }

  function handleAdTypeChange(value: string) {
    router.push(`${pathname}?${buildParams({ adType: value === 'all' ? '' : value })}`)
  }

  function handleReset() {
    router.push(pathname)
  }

  const hasFilter = from || to || (adType && adType !== 'all')

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* 날짜 범위 */}
      <div className="flex items-center gap-2">
        <span className="text-sm whitespace-nowrap text-muted-foreground">기간</span>
        <Input
          type="date"
          value={from}
          max={today}
          onChange={(e) => handleFromChange(e.target.value)}
          className="w-36 text-sm"
        />
        <span className="text-sm text-muted-foreground">~</span>
        <Input
          type="date"
          value={to}
          min={from || undefined}
          max={today}
          onChange={(e) => handleToChange(e.target.value)}
          className="w-36 text-sm"
        />
      </div>

      {/* 광고유형 필터 */}
      <div className="flex items-center gap-2">
        <span className="text-sm whitespace-nowrap text-muted-foreground">광고유형</span>
        <Select value={adType || 'all'} onValueChange={handleAdTypeChange}>
          <SelectTrigger className="w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {adTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 초기화 버튼 */}
      {hasFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          초기화
        </Button>
      )}
    </div>
  )
}
