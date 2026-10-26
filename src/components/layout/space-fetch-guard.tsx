'use client'
import { useEffect } from 'react'
import { SPACE_HEADER } from '@/lib/spaces/current-space-cookie'

// 모듈 단위 — fetch 패치는 한 번만, 현재 Space 는 effect 에서 갱신한다.
let currentSpaceId: string | null = null
let installed = false

const isRequest = (x: unknown): x is Request =>
  typeof Request !== 'undefined' && x instanceof Request

function install() {
  if (installed) return
  installed = true
  const original = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (!currentSpaceId) return original(input, init)
    const method = (init?.method ?? (isRequest(input) ? input.method : 'GET')).toUpperCase()
    if (method === 'GET' || method === 'HEAD') return original(input, init)
    let url: URL
    try {
      const raw = isRequest(input) ? input.url : input
      url = new URL(raw instanceof URL ? raw.href : raw, window.location.href)
    } catch {
      return original(input, init)
    }
    // 교차 출처(Supabase 등)에 커스텀 헤더를 붙이면 CORS preflight 로 깨진다
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return original(input, init)
    }
    const headers = new Headers(init?.headers ?? (isRequest(input) ? input.headers : undefined))
    if (!headers.has(SPACE_HEADER)) headers.set(SPACE_HEADER, currentSpaceId)
    // init.headers 가 우선이라 Request 의 body·메서드는 그대로 보존된다
    return original(input, { ...init, headers })
  }
}

/** 변경 요청(/api/*)에 화면의 Space 를 실어 보내는 fetch 가드. 렌더 결과 없음. */
export function SpaceFetchGuard({ spaceId }: { spaceId: string | null }) {
  useEffect(() => {
    currentSpaceId = spaceId
    install()
  }, [spaceId])
  return null
}
