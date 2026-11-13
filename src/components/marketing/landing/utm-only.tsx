'use client'

import { useSyncExternalStore, type ReactNode } from 'react'

const noopSubscribe = () => () => {}

/** 정적 페이지에서 utm_source가 맞는 방문자에게만 children을 보인다. 서버 렌더는 항상 숨김. */
export function UtmOnly({ source, children }: { source: string; children: ReactNode }) {
  const show = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get('utm_source') === source,
    () => false
  )
  return show ? children : null
}
