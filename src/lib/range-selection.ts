export function applyRangeSelection(
  prev: Set<string>,
  allKeys: string[],
  key: string,
  index: number,
  shiftKey: boolean,
  lastIndex: number | null
): Set<string> {
  const next = new Set(prev)
  if (shiftKey && lastIndex !== null) {
    const from = Math.min(lastIndex, index)
    const to = Math.max(lastIndex, index)
    const adding = !prev.has(key)
    for (const k of allKeys.slice(from, to + 1)) {
      if (adding) next.add(k)
      else next.delete(k)
    }
  } else if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  return next
}
