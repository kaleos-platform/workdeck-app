import { useCallback } from 'react'

/**
 * Recharts 툴팁은 pointer-events: none + 마우스 추종이라 툴팁 안 스크롤 영역에 휠이 닿지 않는다.
 * 차트 래퍼에 이 ref 를 달면 휠을 [data-tooltip-scroll] 요소로 넘긴다.
 * 목록 끝에 닿았거나 스크롤할 게 없으면 페이지 스크롤을 그대로 둔다.
 */
export function useTooltipWheelScroll() {
  return useCallback((wrapper: HTMLDivElement | null) => {
    if (!wrapper) return
    const onWheel = (e: WheelEvent) => {
      const el = wrapper.querySelector<HTMLElement>('[data-tooltip-scroll]')
      if (!el) return
      const atTop = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return
      el.scrollTop += e.deltaY
      e.preventDefault()
    }
    // React onWheel 은 passive 라 preventDefault 불가 → 직접 등록
    wrapper.addEventListener('wheel', onWheel, { passive: false })
    return () => wrapper.removeEventListener('wheel', onWheel)
  }, [])
}
