'use client'
import { useState, useSyncExternalStore } from 'react'
import { ChevronsUpDown, Info, Loader2, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CreateSpaceDialog } from '@/components/layout/create-space-dialog'
import { MAX_OWNED_SPACES } from '@/lib/spaces/owned-space-limit'
import type { Role } from '@/lib/auth/roles'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export type SpaceItem = { id: string; name: string; role: Role }

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: '소유자',
  ADMIN: '관리자',
  MEMBER: '구성원',
}
// 업무별 쓰기 권한은 따로 판정된다(canWriteDeck) — 구성원 설명을 넓게 쓰지 않는다.
export const ROLE_HINT: Record<Role, string> = {
  OWNER: '결제·구독과 모든 설정을 관리합니다',
  ADMIN: '외부 서비스 연결·AI 설정과 구성원을 관리합니다',
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

  /** 성공하면 true(페이지가 내려간다), 막히거나 실패하면 false. */
  async function switchTo(spaceId: string): Promise<boolean> {
    if (switching || spaceId === currentSpaceId) return false
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
        return true
      }
      setError(FAIL_MESSAGE[res.status] ?? '작업 공간을 바꾸지 못했습니다. 다시 시도하세요.')
    } catch {
      setError('네트워크 오류로 바꾸지 못했습니다. 다시 시도하세요.')
    }
    setSwitching(false)
    return false
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

/** 사이드바 상단 현재 작업 공간 카드. 눌러서 전환하거나(1개여도) 새 작업 공간을 만든다. */
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
  const [createOpen, setCreateOpen] = useState(false)
  // 닫힐 때마다 Dialog 를 다시 마운트해 입력값·오류를 비운다(성공 경로 포함).
  const [createKey, setCreateKey] = useState(0)
  const current = spaces.find((s) => s.id === currentSpaceId)
  if (!current) return null
  const role = ROLE_LABEL[current.role]
  const ownedCount = spaces.filter((s) => s.role === 'OWNER').length
  const limitReached = ownedCount >= MAX_OWNED_SPACES

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
      {pending ? (
        <Loader2 className="size-4 flex-shrink-0 animate-spin text-zinc-400" />
      ) : (
        <ChevronsUpDown className="size-4 flex-shrink-0 text-zinc-400" />
      )}
    </>
  )
  const boxClass = cn(
    'flex w-full items-center gap-2 rounded-lg',
    collapsed ? 'justify-center p-1' : 'border border-white/10 bg-white/[0.04] p-2'
  )

  return (
    <div className={cn('flex-shrink-0 pt-3', collapsed ? 'px-2' : 'px-3')}>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem
            // disabled 는 키보드 포커스에서 빠져 상한 안내를 못 읽는다 — aria-disabled 로 두고 선택만 막는다.
            aria-disabled={limitReached || undefined}
            onSelect={(e) => {
              if (limitReached) return e.preventDefault()
              setCreateOpen(true)
            }}
            className="items-start aria-disabled:opacity-50"
          >
            <Plus className="mt-0.5 size-4" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">새 작업 공간 만들기</span>
              {limitReached && (
                <span className="block text-xs text-muted-foreground">
                  소유한 작업 공간은 {MAX_OWNED_SPACES}개까지입니다. 더 필요하면 문의해 주세요.
                </span>
              )}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateSpaceDialog
        key={createKey}
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setCreateKey((k) => k + 1)
        }}
        onCreated={async (id) => {
          setCreateOpen(false)
          setCreateKey((k) => k + 1)
          // 공간은 만들어졌으니 전환만 실패한 경우 — 접힌 사이드바에서도 보이게 알리고 메뉴에서 고르게 한다.
          if (!(await switchTo(id)))
            toast.error(
              '작업 공간을 만들었지만 전환하지 못했습니다. 새로고침한 뒤 메뉴에서 선택하세요.'
            )
        }}
      />
      {error && !collapsed && (
        <p role="alert" className="mt-1 px-1 text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * 내 워크덱 홈 제목 위 작업 공간 맥락 줄 — 「작업 공간 › 내 워크덱」 위계.
 * 권한 설명은 ⓘ 팝오버(클릭·키보드)에, 다른 공간은 「전환」 메뉴에 숨긴다.
 */
export function SpaceContext({
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
  const role = ROLE_LABEL[current.role]

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Initial name={current.name} className="size-6 bg-muted text-xs text-foreground" />
        <span className="font-semibold">{current.name}</span>
        <Popover>
          <PopoverTrigger
            aria-label={`내 권한 ${role} 안내`}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {role}
            <Info className="size-3" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 text-sm">
            <p className="font-medium">내 권한: {role}</p>
            <p className="mt-1 text-muted-foreground">{ROLE_HINT[current.role]}</p>
          </PopoverContent>
        </Popover>
        {spaces.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={pending}
              aria-label={`작업 공간 전환 — 현재 ${current.name} (${role})`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ChevronsUpDown className="size-3.5" />
              )}
              전환
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <SpaceMenuItems spaces={spaces} currentSpaceId={currentSpaceId} onSelect={switchTo} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
