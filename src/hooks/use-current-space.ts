'use client'
import { useEffect, useState } from 'react'

// 위험한 쓰기 UI 에 현재 Space 이름을 보여 주기 위한 훅. 못 받으면 null(기존 문구 유지).
export function useCurrentSpaceName(): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/spaces/current')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setName(d?.current?.name ?? null))
      .catch(() => setName(null))
  }, [])
  return name
}
