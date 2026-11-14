'use client'
import { useEffect } from 'react'
import { toast } from 'sonner'
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

/**
 * 변경 요청(/api/*)에 화면의 Space 를 실어 보내는 fetch 가드. 렌더 결과 없음.
 * watchSwitch: 탭으로 돌아왔을 때 다른 탭에서 작업 공간이 바뀌었으면 새로고침을 안내한다
 * (이미 그려진 데이터는 이전 공간 것 — 변경 요청은 API 가 409 로 막는다).
 */
export function SpaceFetchGuard({
  spaceId,
  watchSwitch = false,
}: {
  spaceId: string | null
  watchSwitch?: boolean
}) {
  useEffect(() => {
    currentSpaceId = spaceId
    install()
  }, [spaceId])

  useEffect(() => {
    if (!watchSwitch || !spaceId) return
    const check = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/spaces/current')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { current: { id: string; name: string } | null } | null) => {
          const now = data?.current
          if (!now || now.id === spaceId) return
          toast.warning(`다른 탭에서 작업 공간이 「${now.name}」(으)로 바뀌었습니다`, {
            id: 'space-switched',
            description:
              '이 화면은 이전 작업 공간의 내용입니다. 새로고침하면 바뀐 공간으로 보여 줍니다.',
            duration: Infinity,
            action: { label: '새로고침', onClick: () => window.location.reload() },
          })
        })
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [spaceId, watchSwitch])
  return null
}
