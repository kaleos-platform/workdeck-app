'use client'
import { useEffect, useState } from 'react'

type SpaceItem = { id: string; name: string; role: string }
const ROLE_LABEL: Record<string, string> = { OWNER: '소유자', ADMIN: '관리자', MEMBER: '구성원' }

/** 사이드바 Space 이름 + 여러 Space 사용자의 전환 메뉴. 전환하면 새 Space 의 내 워크덱 홈으로 새로고침. */
export function SpaceSwitcher({
  fallbackName,
  navigate = (url) => window.location.assign(url), // jsdom 에서 location 을 바꿀 수 없어 테스트용으로 주입
}: {
  fallbackName: string
  navigate?: (url: string) => void
}) {
  const [data, setData] = useState<{ current: SpaceItem | null; spaces: SpaceItem[] } | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    fetch('/api/spaces/current')
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
  }, [])

  const name = data?.current?.name ?? fallbackName
  if (!data || data.spaces.length < 2) {
    return <p className="text-xs font-semibold tracking-wide text-zinc-200 uppercase">{name}</p>
  }

  async function switchTo(spaceId: string) {
    if (spaceId === data?.current?.id) return
    setPending(true)
    try {
      const res = await fetch('/api/spaces/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId }),
      })
      if (res.ok) {
        navigate('/my-deck')
        return
      }
    } catch {
      // 네트워크 오류: 아래에서 다시 활성화
    }
    setPending(false)
  }

  return (
    <select
      aria-label="Space 전환"
      className="w-full rounded-md bg-transparent text-xs font-semibold text-zinc-200"
      value={data.current?.id ?? ''}
      disabled={pending}
      onChange={(e) => switchTo(e.target.value)}
    >
      {data.spaces.map((s) => (
        <option key={s.id} value={s.id} className="text-zinc-900">
          {s.name} · {ROLE_LABEL[s.role] ?? s.role}
        </option>
      ))}
    </select>
  )
}
