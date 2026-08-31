'use client'

// 워크스페이스 브랜드명 — 검색어 §10 판정에서 상품명 단어로 치지 않기 위해 쓴다.
//
// 모듈 레벨로 한 번만 받아온다. KeywordEditor 가 화면당 여러 개 뜨는 곳이 있어(키워드 관리
// 상품 축은 채널 수만큼) 인스턴스마다 조회하면 같은 응답을 반복해서 받는다. 브랜드는 거의
// 바뀌지 않으므로 새로 추가한 브랜드는 새로고침 후에 반영된다 — 판정 보조 정보라 그 정도면 된다.

import { useEffect, useState } from 'react'

let cache: Promise<string[]> | null = null

function loadBrandNames(): Promise<string[]> {
  // jest/SSR 등 fetch 가 없는 환경에서도 죽지 않아야 한다 — 없으면 그냥 빈 목록이다.
  if (typeof fetch !== 'function') return Promise.resolve([])
  return fetch('/api/sh/brands')
    .then((res) => (res.ok ? res.json() : { brands: [] }))
    .then((data: { brands?: { name?: unknown }[] }) =>
      (data.brands ?? [])
        .map((b) => (typeof b.name === 'string' ? b.name.trim() : ''))
        .filter(Boolean)
    )
    .catch(() => [])
}

export function useBrandNames(): string[] {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    cache ??= loadBrandNames()
    let cancelled = false
    void cache.then((v) => {
      if (!cancelled) setNames(v)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return names
}
