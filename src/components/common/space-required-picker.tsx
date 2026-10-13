'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

export type SpaceChoice = { id: string; name: string; role: string }

/** 여러 Space에 속한 사용자가 Space를 고르게 한다. 선택은 URL ?spaceId= 로만 남긴다(공유·새로고침에도 유지). */
export function SpaceRequiredPicker({ spaces }: { spaces: SpaceChoice[] }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const hrefFor = (id: string) => {
    const next = new URLSearchParams(params.toString())
    next.set('spaceId', id) // slack= 상태는 지우지 않는다(team_changed 재연결 버튼 조건)
    return `${pathname}?${next.toString()}`
  }
  return (
    <div className="space-y-2 rounded-md border border-dashed p-4 text-sm">
      <p className="text-muted-foreground">
        여러 Space에 속해 있습니다. 어느 Space의 설정을 볼지 고르세요.
      </p>
      <ul className="flex flex-wrap gap-2">
        {spaces.map((s) => (
          <li key={s.id}>
            <Link className="underline" href={hrefFor(s.id)}>
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 400 SPACE_REQUIRED 응답이면 선택지를, 아니면 null을 돌려준다. */
export async function readSpaceRequired(res: Response): Promise<SpaceChoice[] | null> {
  if (res.status !== 400) return null
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: string; spaces?: SpaceChoice[] } | null
  return body?.code === 'SPACE_REQUIRED' ? (body.spaces ?? []) : null
}
