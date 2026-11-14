'use client'
import { useState, useSyncExternalStore } from 'react'
import { ChevronsUpDown, Loader2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Role } from '@/lib/auth/roles'
import { cn } from '@/lib/utils'

export type SpaceItem = { id: string; name: string; role: Role }

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: '소유자',
  ADMIN: '관리자',
  MEMBER: '구성원',
}
// 업무별 쓰기 권한은 따로 판정된다(canWriteDeck) — 구성원 설명을 넓게 쓰지 않는다.
export const ROLE_HINT: Record<Role, string> = {
  OWNER: '결제·구독과 모든 설정을 관리합니다',
  ADMIN: '연동·AI 설정과 구성원을 관리합니다',
  MEMBER: '사용 중인 업무를 이용합니다(일부 업무는 조회만 가능)',
}

type Navigate = (url: string) => void
const defaultNavigate: Navigate = (url) => window.location.assign(url)

// 전환 중 상태는 사이드바·홈이 공유한다 — 두 곳에서 연달아 눌러도 요청은 하나.
let switching = false
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const setSwitching = (v: boolean) => {
  switching = v
  listeners.forEach((fn) => fn())
}
// 뒤로 가기로 bfcache 에서 복원되면 이동 전 잠금이 남아 있다 — 풀어 준다.
if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) setSwitching(false)
  })
}
/** 테스트 전용 — 성공한 전환은 페이지가 내려갈 때까지 잠겨 있다. */
export const resetSpaceSwitchForTest = () => setSwitching(false)

const FAIL_MESSAGE: Record<number, string> = {
  401: '로그인이 만료되었습니다. 다시 로그인한 뒤 시도하세요.',
  404: '이 작업 공간에 더 이상 소속되어 있지 않습니다. 새로고침하세요.',
}

/** POST /api/spaces/current(멤버십 검증·쿠키) 성공 후에만 새 작업 공간의 내 워크덱 홈으로 전체 이동. */
function useSwitchSpace(currentSpaceId: string | null, navigate: Navigate) {
  const pending = useSyncExternalStore(
    subscribe,
    () => switching,
    () => false
  )
  const [error, setError] = useState<string | null>(null)

  async function switchTo(spaceId: string) {
    if (switching || spaceId === currentSpaceId) return
    setSwitching(true)
    setError(null)
    try {
      const res = await fetch('/api/spaces/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId }),
      })
      if (res.ok) {
        // 전체 새로고침 — 라우터 캐시와 새 작업 공간에 없는 업무 경로를 함께 피한다. 페이지가 내려갈 때까지 잠근다.
        navigate('/my-deck')
        return
      }
      setError(FAIL_MESSAGE[res.status] ?? '작업 공간을 바꾸지 못했습니다. 다시 시도하세요.')
    } catch {
      setError('네트워크 오류로 바꾸지 못했습니다. 다시 시도하세요.')
    }
    setSwitching(false)
  }

  return { pending, error, switchTo }
}

function Initial({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 flex-shrink-0 items-center justify-center rounded-md text-sm font-semibold',
        className
      )}
    >
      {name.trim().charAt(0) || '?'}
    </span>
  )
}

function SpaceMenuItems({
  spaces,
  currentSpaceId,
  onSelect,
}: {
  spaces: SpaceItem[]
  currentSpaceId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        작업 공간 전환
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup value={currentSpaceId ?? ''} onValueChange={onSelect}>
        {spaces.map((s) => (
          <DropdownMenuRadioItem key={s.id} value={s.id} className="items-start">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block text-xs text-muted-foreground">
                {ROLE_LABEL[s.role]} · {ROLE_HINT[s.role]}
              </span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}

/** 사이드바 상단 현재 작업 공간 카드. 2개 이상이면 눌러서 전환. */
export function SpaceSwitcher({
  spaces,
  currentSpaceId,
  collapsed = false,
  navigate = defaultNavigate, // jsdom 에서 location 을 바꿀 수 없어 테스트용으로 주입
}: {
  spaces: SpaceItem[]
  currentSpaceId: string | null
  collapsed?: boolean
  navigate?: Navigate
}) {
  const { pending, error, switchTo } = useSwitchSpace(currentSpaceId, navigate)
  const current = spaces.find((s) => s.id === currentSpaceId)
  if (!current) return null
  const multi = spaces.length > 1
  const role = ROLE_LABEL[current.role]

  const body = collapsed ? (
    <Initial name={current.name} className="bg-white/10 text-white" />
  ) : (
    <>
      <Initial name={current.name} className="bg-white/10 text-white" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[11px] text-zinc-400">작업 공간</span>
        <span className="block truncate text-sm font-semibold text-white">{current.name}</span>
      </span>
      <span className="flex-shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-200">
        {role}
      </span>
      {multi &&
        (pending ? (
          <Loader2 className="size-4 flex-shrink-0 animate-spin text-zinc-400" />
        ) : (
          <ChevronsUpDown className="size-4 flex-shrink-0 text-zinc-400" />
        ))}
    </>
  )
  const boxClass = cn(
    'flex w-full items-center gap-2 rounded-lg',
    collapsed ? 'justify-center p-1' : 'border border-white/10 bg-white/[0.04] p-2'
  )

  return (
    <div className={cn('flex-shrink-0 pt-3', collapsed ? 'px-2' : 'px-3')}>
      {multi ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={pending}
            aria-label={`작업 공간 전환 — 현재 ${current.name} (${role})`}
            className={cn(
              boxClass,
              'transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none'
            )}
          >
            {body}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-64">
            <SpaceMenuItems spaces={spaces} currentSpaceId={currentSpaceId} onSelect={switchTo} />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className={boxClass} title={`${current.name} (${role})`}>
          {collapsed && <span className="sr-only">{`작업 공간 ${current.name} (${role})`}</span>}
          {body}
        </div>
      )}
      {error && !collapsed && (
        <p role="alert" className="mt-1 px-1 text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

const CHIP_LIMIT = 5

/** 내 워크덱 홈 — 소속 작업 공간·권한 칩. 6개 이상이면 메뉴로. */
export function SpaceChips({
  spaces,
  currentSpaceId,
  navigate = defaultNavigate,
}: {
  spaces: SpaceItem[]
  currentSpaceId: string | null
  navigate?: Navigate
}) {
  const { pending, error, switchTo } = useSwitchSpace(currentSpaceId, navigate)
  const current = spaces.find((s) => s.id === currentSpaceId)
  if (!current) return null
  const multi = spaces.length > 1

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {multi ? '소속 작업 공간' : '작업 공간'}
        </span>
        {spaces.length > CHIP_LIMIT ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={pending}
              aria-label={`작업 공간 전환 — 현재 ${current.name} (${ROLE_LABEL[current.role]})`}
              className="inline-flex items-center gap-1.5 rounded-full border bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {current.name} · {ROLE_LABEL[current.role]}
              <ChevronsUpDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <SpaceMenuItems spaces={spaces} currentSpaceId={currentSpaceId} onSelect={switchTo} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          spaces.map((s) => {
            const isCurrent = s.id === currentSpaceId
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={isCurrent}
                disabled={pending || !multi}
                onClick={() => switchTo(s.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition',
                  isCurrent
                    ? 'border-primary bg-primary font-medium text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted',
                  'disabled:cursor-default disabled:opacity-60',
                  isCurrent && 'disabled:opacity-100'
                )}
              >
                <span className="max-w-48 truncate">{s.name}</span>
                <span className={cn('text-xs', !isCurrent && 'text-muted-foreground')}>
                  · {ROLE_LABEL[s.role]}
                </span>
              </button>
            )
          })
        )}
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground">
        내 권한: {ROLE_LABEL[current.role]} — {ROLE_HINT[current.role]}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
