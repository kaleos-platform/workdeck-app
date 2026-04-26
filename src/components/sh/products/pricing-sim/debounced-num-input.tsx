'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Props = {
  value: number
  onCommit: (v: number) => void
  suffix?: string
  step?: number
  min?: number
  placeholder?: string
  debounceMs?: number
  className?: string
  inputClassName?: string
  disabled?: boolean
}

/**
 * 숫자 입력 — 키 입력 중에는 부모 state를 갱신하지 않고, blur 또는 debounce 시점에 한번 갱신.
 * matrix/chart 즉시 재계산으로 인한 입력 끊김을 방지.
 */
export function DebouncedNumInput({
  value,
  onCommit,
  suffix,
  step = 1,
  min = 0,
  placeholder = '0',
  debounceMs = 400,
  className,
  inputClassName,
  disabled,
}: Props) {
  // 사용자 키 입력은 string으로 보존하여 빈 문자열/소수점 입력 자유롭게 허용
  const [draft, setDraft] = useState<string>(() => (value === 0 ? '' : String(value)))
  const editingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 부모 value가 외부에서 변경된 경우(예: 시나리오 로드, 다른 옵션 추가) sync
  // React 19 호환: useEffect body에서 직접 setState 금지 → microtask로 defer
  useEffect(() => {
    if (editingRef.current) return // 사용자 편집 중이면 외부 변경 무시
    Promise.resolve().then(() => setDraft(value === 0 ? '' : String(value)))
  }, [value])

  // 컴포넌트 unmount 시 timer 정리
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  function commitNow(raw: string) {
    const parsed = raw === '' ? 0 : Number(raw)
    if (!Number.isFinite(parsed)) return
    if (parsed === value) return
    onCommit(parsed)
  }

  function scheduleCommit(raw: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      editingRef.current = false
      commitNow(raw)
    }, debounceMs)
  }

  return (
    <div className={cn('relative flex items-center', className)}>
      <Input
        type="number"
        value={draft}
        step={step}
        min={min}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'h-8 w-24 [appearance:textfield] pr-6 text-right text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          inputClassName
        )}
        onChange={(e) => {
          editingRef.current = true
          const v = e.target.value
          setDraft(v)
          scheduleCommit(v)
        }}
        onBlur={() => {
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
          editingRef.current = false
          commitNow(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (timerRef.current) {
              clearTimeout(timerRef.current)
              timerRef.current = null
            }
            editingRef.current = false
            commitNow(draft)
          }
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  )
}
