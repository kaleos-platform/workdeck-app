'use client'
import { useEffect, useState } from 'react'

export type CurrentSpace = { id: string; name: string }

// 위험한 쓰기 UI 에 현재 Space 를 보여 주기 위한 훅. 못 받으면 null(기존 문구 유지).
// 다른 탭에서 Space 를 바꿨을 수 있으므로 탭이 다시 보이거나 포커스를 받을 때 다시 조회한다.
export function useCurrentSpace(): CurrentSpace | null {
  const [space, setSpace] = useState<CurrentSpace | null>(null)
  useEffect(() => {
    let alive = true
    let seq = 0
    const load = () => {
      const mine = ++seq
      const apply = (v: CurrentSpace | null) => alive && mine === seq && setSpace(v)
      fetch('/api/spaces/current')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const c = d?.current
          apply(c?.id && c?.name ? { id: c.id, name: c.name } : null)
        })
        .catch(() => apply(null))
    }
    const onVisible = () => document.visibilityState === 'visible' && load()
    load()
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return space
}

// 쓰기 대상이 쿠키(현재 Space)인 화면용 — 이름만.
export function useCurrentSpaceName(): string | null {
  return useCurrentSpace()?.name ?? null
}
