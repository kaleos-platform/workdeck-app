'use client'

import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'

const subscribe = () => () => {}

function cameFromSameSite() {
  try {
    return new URL(document.referrer).origin === window.location.origin
  } catch {
    return false
  }
}

// 같은 사이트 안에서 넘어온 경우에만 보인다 — history.length 는 외부 사이트 기록까지 센다.
export function BackButton() {
  const visible = useSyncExternalStore(subscribe, cameFromSameSite, () => false)

  if (!visible) return null

  return (
    <Button variant="outline" onClick={() => window.history.back()}>
      이전 페이지로
    </Button>
  )
}
