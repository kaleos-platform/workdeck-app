'use client'

/**
 * 테이블 다중 선택 훅 — shift+클릭 연속 선택 지원.
 * Radix Checkbox의 onCheckedChange는 이벤트 객체가 없으므로, Checkbox에
 * checkboxShiftProps(onPointerDown/onKeyDown)를 함께 부착해 shift 여부를 ref로 전달받는다.
 * 앵커(마지막 클릭 인덱스)~클릭 인덱스 범위 전체에 클릭된 체크 상태를 적용한다.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

export function useShiftSelect(rowIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastIndexRef = useRef<number | null>(null)
  const shiftRef = useRef(false)

  // 행 목록 변경(탭·필터·재조회) 시 앵커가 낡으므로 리셋
  const idsKey = rowIds.join('\u0000')
  useEffect(() => {
    lastIndexRef.current = null
  }, [idsKey])

  const selectedInView = rowIds.filter((id) => selectedIds.has(id))
  const allSelected = rowIds.length > 0 && selectedInView.length === rowIds.length

  /** 행 체크박스에 spread — shift 상태 포착 + shift 클릭 시 텍스트 선택 방지 */
  const checkboxShiftProps = {
    onPointerDown: (e: ReactPointerEvent) => {
      shiftRef.current = e.shiftKey
      if (e.shiftKey) e.preventDefault()
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      shiftRef.current = e.shiftKey
    },
  }

  const toggleAt = (index: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const anchor = shiftRef.current ? lastIndexRef.current : null
      const [from, to] =
        anchor == null ? [index, index] : [Math.min(anchor, index), Math.max(anchor, index)]
      for (let i = from; i <= to; i++) {
        if (checked) next.add(rowIds[i])
        else next.delete(rowIds[i])
      }
      return next
    })
    lastIndexRef.current = index
    shiftRef.current = false
  }

  const toggleAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) rowIds.forEach((id) => next.delete(id))
      else rowIds.forEach((id) => next.add(id))
      return next
    })

  const clearSelection = () => setSelectedIds(new Set())

  /** 삭제 등으로 사라진 id만 선택에서 제거(전체 해제 없이) */
  const removeFromSelection = (ids: string[]) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })

  return {
    selectedIds,
    selectedInView,
    allSelected,
    toggleAt,
    toggleAll,
    clearSelection,
    removeFromSelection,
    checkboxShiftProps,
  }
}
