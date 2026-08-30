'use client'

// name-draft-dialog.tsx 가 소유하던 fetch 로직을 훅으로 뽑았다 — 상품명 다이얼로그와 키워드
// 다이얼로그가 이 훅 하나를 공유해서 화면 방문당 API 호출을 1회로 고정한다(서버가 한 번의
// Gemini 호출로 상품명 후보·검색어 후보·등록 검색어 진단을 함께 만든다 —
// src/lib/sh/keyword-ai-draft.ts 의 draftProductNames).
//
// 캐시가 안전한 근거: AI 입력은 서버가 DB 에서 읽은 값(InvProduct·마스터 링크·리스팅/채널상품
// 키워드)에서 오고, 사용자가 화면에서 타이핑 중인 값과는 무관하다. 무엇을 입력해도 후보 자체는
// 바뀌지 않으므로 한 번 받아온 결과를 재사용해도 된다.
//
// 다만 reviews 는 로드 시점의 등록 검색어를 기준으로 만들어진다 — 사용자가 키워드를 지우면
// 화면의 목록과 어긋난다. 재호출하지 않고 **다이얼로그가 정규화 기준으로 조인**해서 흡수한다
// (name-draft-dialog.tsx 의 reviewByKey).

import { useEffect, useRef, useState } from 'react'

import type { KeywordReview, ScoredKeyword } from '@/lib/sh/keyword-draft-filter'
import type { Violation } from '@/lib/sh/keyword-validate'

export type DraftCandidate = { value: string; violations: Violation[] }
/** 검색어 후보 — 상품명 후보와 달리 생성 축(intent)과 사유가 붙어 온다. */
export type DraftKeywordCandidate = ScoredKeyword
/** 이미 등록된 검색어에 대한 진단 — 서버가 결정적 검증 + AI 판정을 합쳐 만든다. */
export type DraftKeywordReview = KeywordReview

type DraftResponse = {
  names: DraftCandidate[]
  keywords: DraftKeywordCandidate[]
  reviews?: DraftKeywordReview[]
  unavailable?: boolean
}

export type NameDraftStatus = 'idle' | 'loading' | 'success' | 'unavailable'

export function useNameDraft(
  productId: string | null,
  channelId: string
): {
  status: NameDraftStatus
  names: DraftCandidate[]
  keywords: DraftKeywordCandidate[]
  reviews: DraftKeywordReview[]
  load: () => void
} {
  const [status, setStatus] = useState<NameDraftStatus>('idle')
  const [names, setNames] = useState<DraftCandidate[]>([])
  const [keywords, setKeywords] = useState<DraftKeywordCandidate[]>([])
  const [reviews, setReviews] = useState<DraftKeywordReview[]>([])

  // 늦게 도착한 응답이 이후 상태를 덮어쓰지 않도록 하는 가드. 값이 바뀔 때마다 새 토큰을 발급하고,
  // 응답을 반영하기 전에 "그 요청을 보낼 때의 토큰이 지금도 최신인지"를 비교한다. 언마운트·
  // productId/channelId 변경 시 토큰이 갱신되므로 늦게 도착한 응답은 자동으로 무시된다.
  const requestTokenRef = useRef(0)

  // 멱등 가드는 **ref 로 잡는다.** status state 로 판정하면 같은 틱에 load() 가 두 번 불릴 때
  // (두 버튼이 한 핸들러에서 호출되거나 React 가 배치할 때) 두 번째 호출이 아직 갱신되지 않은
  // 'idle' 을 읽어 fetch 가 두 번 나간다 — 서버가 한 번의 Gemini 호출로 결과를 만들므로 그대로
  // AI 비용 2배다. ref 는 동기 반영되므로 그 창이 없다.
  const startedRef = useRef(false)

  // productId·channelId 가 바뀌면 이전 결과는 다른 대상 것이라 재사용할 수 없다 — idle 로
  // 되돌려 다음 load() 가 새로 받아오게 한다. 진행 중이던 요청도 이 시점에 토큰이 바뀌어
  // 무효화된다.
  useEffect(() => {
    requestTokenRef.current += 1
    startedRef.current = false
    setStatus('idle')
    setNames([])
    setKeywords([])
    setReviews([])
  }, [productId, channelId])

  useEffect(() => {
    // 언마운트 시 진행 중인 요청의 결과를 버린다.
    return () => {
      requestTokenRef.current += 1
    }
  }, [])

  function load() {
    // 멱등 — 두 버튼이 같은 훅을 공유하므로 이미 로드됐거나 로드 중이면 아무것도 하지 않는다.
    if (startedRef.current) return
    if (!productId) return
    startedRef.current = true

    const token = ++requestTokenRef.current

    setStatus('loading')

    const run = async () => {
      try {
        const res = await fetch(`/api/sh/products/${productId}/name-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId }),
        })
        if (!res.ok) throw new Error('요청 실패')
        const data: DraftResponse = await res.json()
        if (requestTokenRef.current !== token) return
        if (data.unavailable) {
          setStatus('unavailable')
          return
        }
        setNames(data.names ?? [])
        setKeywords(data.keywords ?? [])
        // 구버전 서버 응답(reviews 없음)에도 안전해야 한다.
        setReviews(data.reviews ?? [])
        setStatus('success')
      } catch {
        // 부가 기능이다 — 네트워크 실패도 조용히 같은 안내로 흡수한다. 에러 토스트는 띄우지 않는다.
        if (requestTokenRef.current === token) setStatus('unavailable')
      }
    }

    void run()
  }

  return { status, names, keywords, reviews, load }
}
