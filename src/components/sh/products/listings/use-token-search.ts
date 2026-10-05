'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { tokenizeProductName } from '@/lib/inv/search-tokens'

/**
 * 검색어 토큰화 + 키워드 칩 + "0건이면 마지막 토큰을 떼고 단계적 완화" 공용 훅.
 * option-picker-dialog.tsx 에서 추출 — coupang-item-picker-dialog.tsx 와 공유한다.
 *
 * 사용법: 다이얼로그가 검색 결과 rows.length 를 안 뒤 `reportResultCount(rows.length)` 를 호출하면
 * 0건일 때 자동 완화가 일어난다. debounce(300ms)된 `debounced` 를 쿼리에 사용할 것.
 */
export function useTokenSearch(params: {
  open: boolean
  /** 원본 문자열(예: 리스팅명). 넘기면 키워드 칩을 만들고 앞쪽 토큰으로 검색을 시작한다. */
  keywordSource?: string
  /** keywordSource 사용 시 처음 선택 상태로 둘 앞쪽 토큰 수(기본 2) */
  initialTokenCount?: number
  /** keywordSource 가 없을 때 초기 검색어로 쓸 값 */
  initialQuery?: string
}) {
  const { open, keywordSource, initialTokenCount = 2, initialQuery = '' } = params

  const keywordTokens = useMemo(
    () => (keywordSource ? tokenizeProductName(keywordSource) : []),
    [keywordSource]
  )
  const seedQuery = useMemo(
    () =>
      keywordTokens.length > 0
        ? keywordTokens.slice(0, Math.max(1, initialTokenCount)).join(' ')
        : initialQuery,
    [keywordTokens, initialTokenCount, initialQuery]
  )

  const [search, setSearchRaw] = useState(seedQuery)
  const [debounced, setDebounced] = useState(seedQuery)
  const [relaxedNote, setRelaxedNote] = useState<string | null>(null)

  // 시드/칩 클릭으로 만들어진 검색어에만 0건 자동 완화를 적용한다.
  // 직접 타이핑 중에는 완화하지 않는다.
  const autoRelaxRef = useRef(false)

  // seedQuery를 렌더 중이 아니라 effect에서 ref에 반영 — open 전환 effect보다 먼저
  // 커밋되므로(선언 순서) open이 true가 되는 같은 렌더에서도 최신값을 읽는다.
  const seedRef = useRef(seedQuery)
  useEffect(() => {
    seedRef.current = seedQuery
  }, [seedQuery])

  useEffect(() => {
    if (open) {
      setSearchRaw(seedRef.current)
      setDebounced(seedRef.current)
      setRelaxedNote(null)
      autoRelaxRef.current = true
    }
  }, [open])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const activeTokens = useMemo(
    () => new Set(tokenizeProductName(search).map((t) => t.toLowerCase())),
    [search]
  )

  const setSearch = useCallback((value: string) => {
    autoRelaxRef.current = false
    setRelaxedNote(null)
    setSearchRaw(value)
  }, [])

  const toggleKeywordToken = useCallback(
    (token: string) => {
      const current = tokenizeProductName(search)
      const key = token.toLowerCase()
      const next = current.some((t) => t.toLowerCase() === key)
        ? current.filter((t) => t.toLowerCase() !== key)
        : [...current, token]
      // 칩 클릭은 명시적 조건 지정이므로 자동 완화하지 않는다.
      autoRelaxRef.current = false
      setRelaxedNote(null)
      setSearchRaw(next.join(' '))
    },
    [search]
  )

  /** 검색 결과 개수를 보고 — 0건이면 마지막 토큰을 떼고 재검색(칩/시드 기원일 때만) */
  const reportResultCount = useCallback(
    (count: number) => {
      if (count !== 0 || !autoRelaxRef.current) return
      const tokens = tokenizeProductName(debounced)
      if (tokens.length <= 1) return
      const next = tokens.slice(0, -1).join(' ')
      setRelaxedNote(next)
      setSearchRaw(next)
    },
    [debounced]
  )

  return {
    keywordTokens,
    search,
    debounced,
    relaxedNote,
    activeTokens,
    setSearch,
    toggleKeywordToken,
    reportResultCount,
  }
}
