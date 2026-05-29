'use client'

import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type Props = {
  value: string
  onChange: (q: string) => void
}

/**
 * 배송 데이터 전체 검색바 (받는분·주문번호·전화·주소).
 *
 * IME-safe debounce — 한글 입력 조합 중 끊김/리마운트를 막기 위해
 * 로컬 상태를 두고 300ms 디바운스로만 부모에 반영한다.
 * (재고현황 toolbar의 commit 9b38863 패턴과 동일)
 */
export function OrderSearchBar({ value, onChange }: Props) {
  // 외부 value 동기화 — React 공식 권장: useState 비교 후 setState 패턴
  const [prevValue, setPrevValue] = useState(value)
  const [local, setLocal] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setLocal(value)
  }

  // debounce 300ms — local이 value와 다를 때만 반영
  useEffect(() => {
    if (local === value) return
    const t = setTimeout(() => {
      onChange(local)
    }, 300)
    return () => clearTimeout(t)
  }, [local, value, onChange])

  return (
    <div className="relative max-w-md">
      <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="받는분·주문번호·전화·주소 검색"
        className="h-9 w-full pr-8 pl-8"
        aria-label="배송 데이터 검색"
      />
      {local && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => setLocal('')}
          aria-label="검색어 지우기"
          className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
