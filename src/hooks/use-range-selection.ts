import { useMemo, useRef, useState } from 'react'

export function useRangeSelection<T>(items: T[], getKey: (item: T) => string) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClickedIndex = useRef<number | null>(null)

  const allKeys = useMemo(() => items.map(getKey), [items, getKey])
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k))
  const someSelected = !allSelected && allKeys.some((k) => selected.has(k))

  function toggleOne(key: string, index: number, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (shiftKey && lastClickedIndex.current !== null) {
        const from = Math.min(lastClickedIndex.current, index)
        const to = Math.max(lastClickedIndex.current, index)
        const rangeKeys = allKeys.slice(from, to + 1)
        const adding = !prev.has(key)
        rangeKeys.forEach((k) => (adding ? next.add(k) : next.delete(k)))
      } else {
        next.has(key) ? next.delete(key) : next.add(key)
      }
      return next
    })
    lastClickedIndex.current = index
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(allKeys) : new Set())
    lastClickedIndex.current = null
  }

  function reset() {
    setSelected(new Set())
    lastClickedIndex.current = null
  }

  return { selected, setSelected, allSelected, someSelected, toggleOne, toggleAll, reset }
}
