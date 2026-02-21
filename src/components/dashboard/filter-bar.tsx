'use client'

import { useRef, useEffect } from 'react'
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

// 오늘 날짜 문자열
function getTodayStr(): string {
  return new Date().toISOString().split('T')[0]
}

// N일 전 날짜 문자열 (offset = 양수, today-offset일)
function daysAgo(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return d.toISOString().split('T')[0]
}

// 퀵 기간 옵션 목록
const QUICK_PERIODS = [
  { label: '오늘', getRange: () => ({ from: getTodayStr(), to: getTodayStr() }) },
  { label: '7일', getRange: () => ({ from: daysAgo(6), to: getTodayStr() }) },
  { label: '14일', getRange: () => ({ from: daysAgo(13), to: getTodayStr() }) },
  { label: '30일', getRange: () => ({ from: daysAgo(29), to: getTodayStr() }) },
  { label: '90일', getRange: () => ({ from: daysAgo(89), to: getTodayStr() }) },
  { label: '180일', getRange: () => ({ from: daysAgo(179), to: getTodayStr() }) },
  {
    label: '이번달',
    getRange: () => {
      const today = new Date()
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: first.toISOString().split('T')[0], to: getTodayStr() }
    },
  },
  {
    label: '지난달',
    getRange: () => {
      const today = new Date()
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const last = new Date(today.getFullYear(), today.getMonth(), 0)
      return {
        from: first.toISOString().split('T')[0],
        to: last.toISOString().split('T')[0],
      }
    },
  },
]

export function FilterBar({ adTypeOptions = DEFAULT_AD_TYPE_OPTIONS }: FilterBarProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const hasInitialized = useRef(false)

  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const adType = searchParams.get('adType') ?? 'all'
  const today = getTodayStr()

  // 초기 진입 시 from/to 없으면 14일 기간으로 자동 설정
  useEffect(() => {
    if (!hasInitialized.current && !from && !to) {
      hasInitialized.current = true
      const { from: f, to: t } = QUICK_PERIODS[2].getRange() // 14일
      const params = new URLSearchParams(searchParams.toString())
      params.set('from', f)
      params.set('to', t)
      router.replace(`${pathname}?${params.toString()}`)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function buildParams(overrides: Record<string, string>): string {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(overrides)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    return params.toString()
  }

  function handleFromChange(value: string) {
    const clamped = value > today ? today : value
    const newTo = to && clamped > to ? clamped : to
    router.push(`${pathname}?${buildParams({ from: clamped, to: newTo })}`)
  }

  function handleToChange(value: string) {
    const clamped = value > today ? today : value
    const newFrom = from && clamped < from ? clamped : from
    router.push(`${pathname}?${buildParams({ from: newFrom, to: clamped })}`)
  }

  function handleAdTypeChange(value: string) {
    router.push(`${pathname}?${buildParams({ adType: value === 'all' ? '' : value })}`)
  }

  function handleReset() {
    router.push(pathname)
  }

  function handleQuickPeriod(getRange: () => { from: string; to: string }) {
    const { from: f, to: t } = getRange()
    router.push(`${pathname}?${buildParams({ from: f, to: t })}`)
  }

  // 현재 from/to와 일치하는 퀵 기간 버튼 확인
  function isActiveQuickPeriod(getRange: () => { from: string; to: string }): boolean {
    const { from: f, to: t } = getRange()
    return from === f && to === t
  }

  const hasFilter = from || to || (adType && adType !== 'all')

  return (
    <div className="space-y-3">
      {/* 퀵 기간 버튼 */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_PERIODS.map((p) => {
          const isActive = isActiveQuickPeriod(p.getRange)
          return (
            <Button
              key={p.label}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleQuickPeriod(p.getRange)}
              className="h-7 px-2.5 text-xs"
            >
              {p.label}
            </Button>
          )
        })}
      </div>

      {/* 날짜/광고유형 필터 */}
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
    </div>
  )
}
