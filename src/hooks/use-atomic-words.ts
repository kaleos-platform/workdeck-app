'use client'

// 워크스페이스 예외 단어(분해 금지 단어) 사전 — 검색어 §10/§12 판정에서 한 덩어리로 본다.
//
// use-brand-names 와 달리 화면에서 **변경**되므로 모듈 캐시만으로는 부족하다. 키워드 관리
// 화면은 채널 수만큼 KeywordEditor 를 띄우는데, 한쪽에서 등록한 단어가 다른 쪽에 반영되지
// 않으면 같은 검색어가 화면마다 다른 판정을 받는다. 그래서 구독자를 두고 갱신을 방송한다.

import { useEffect, useState } from 'react'

export type AtomicWord = { id: string; word: string }

// 빈 사전은 **같은 배열 참조**로 돌려준다 — 매번 새 [] 를 넘기면 값이 안 변해도 리렌더가 돌고,
// 테스트에서는 act() 밖 상태 갱신 경고로 나타난다.
const EMPTY: AtomicWord[] = []

let cache: Promise<AtomicWord[]> | null = null
const subscribers = new Set<(words: AtomicWord[]) => void>()

function load(): Promise<AtomicWord[]> {
  // jest/SSR 등 fetch 가 없는 환경에서도 죽지 않아야 한다 — 없으면 그냥 빈 사전이다.
  if (typeof fetch !== 'function') return Promise.resolve(EMPTY)
  return fetch('/api/sh/keyword-atomic-words')
    .then((res) => (res.ok ? res.json() : { words: [] }))
    .then((data: { words?: { id?: unknown; word?: unknown }[] }) =>
      (data.words ?? [])
        .map((w) => ({
          id: typeof w.id === 'string' ? w.id : '',
          word: typeof w.word === 'string' ? w.word.trim() : '',
        }))
        .filter((w) => w.id && w.word)
    )
    .then((words) => (words.length === 0 ? EMPTY : words))
    .catch(() => EMPTY)
}

function refresh(): Promise<AtomicWord[]> {
  cache = load()
  void cache.then((words) => subscribers.forEach((fn) => fn(words)))
  return cache
}

export type AtomicWordsApi = {
  words: AtomicWord[]
  /** 검증기에 넘길 표기 목록 */
  names: string[]
  add: (word: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useAtomicWords(): AtomicWordsApi {
  const [words, setWords] = useState<AtomicWord[]>([])

  useEffect(() => {
    cache ??= load()
    let cancelled = false
    const notify = (v: AtomicWord[]) => {
      if (!cancelled) setWords(v)
    }
    void cache.then(notify)
    subscribers.add(notify)
    return () => {
      cancelled = true
      subscribers.delete(notify)
    }
  }, [])

  return {
    words,
    names: words.map((w) => w.word),
    add: async (word: string) => {
      const trimmed = word.trim()
      if (trimmed.length < 2) return
      const res = await fetch('/api/sh/keyword-atomic-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: trimmed }),
      })
      if (!res.ok) return
      await refresh()
    },
    remove: async (id: string) => {
      const res = await fetch(`/api/sh/keyword-atomic-words/${id}`, { method: 'DELETE' })
      if (!res.ok) return
      await refresh()
    },
  }
}
