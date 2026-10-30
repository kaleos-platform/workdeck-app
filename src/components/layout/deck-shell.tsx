import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import { MobileRecruitingNavigation } from '@/components/layout/mobile-recruiting-navigation'
import { SpaceFetchGuard } from '@/components/layout/space-fetch-guard'
import { resolveSpaceContext } from '@/lib/api-helpers'
import type { DeckVariant } from '@/lib/deck-meta'
import type { Role } from '@/lib/auth/roles'

type DeckShellProps = {
  workspaceName: string
  variant: DeckVariant
  mode?: 'default' | 'my-deck'
  activeDecks?: Array<{ id: string; name: string }>
  /** sales-content 등 deck-scoped CSS(`[data-deck='...']`)가 필요한 경우 전달 */
  dataDeck?: string
  /** 구독·결제 메뉴 노출 여부 (SpaceMember.role === 'OWNER') */
  isOwner?: boolean
  /** 설정 메뉴 노출 판정용 Space 역할 */
  role?: Role
  /** 쓰기 권한이 없는 Deck 에서 상단에 보이는 조회 전용 안내 */
  readOnlyNotice?: string
  children: React.ReactNode
}

/**
 * 모든 deck이 공유하는 앱 셸.
 * 전체 높이 사이드바(로고 상단) + 우측 컬럼(헤더 + 본문) 구조.
 * 향후 새 deck은 layout에서 이 컴포넌트만 사용하면 동일한 UI가 적용된다.
 */
export async function DeckShell({
  workspaceName,
  variant,
  mode,
  activeDecks,
  dataDeck,
  isOwner,
  role,
  readOnlyNotice,
  children,
}: DeckShellProps) {
  const ctx = await resolveSpaceContext()
  const sidebar = (
    <Sidebar
      workspaceName={workspaceName}
      variant={variant}
      mode={mode}
      activeDecks={activeDecks}
      isOwner={isOwner}
      role={role}
    />
  )
  return (
    <div className="flex h-screen" data-deck={dataDeck}>
      <SpaceFetchGuard spaceId={'error' in ctx ? null : ctx.space.id} />
      {variant === 'recruiting' ? <div className="hidden h-full md:block">{sidebar}</div> : sidebar}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {variant === 'recruiting' ? (
          <div className="flex items-center border-b md:block md:border-0">
            <MobileRecruitingNavigation workspaceName={workspaceName} role={role} />
            <div className="min-w-0 flex-1">
              <Header variant={variant} />
            </div>
          </div>
        ) : (
          <Header variant={variant} />
        )}
        <main className="flex-1 overflow-y-auto">
          <div className={variant === 'recruiting' ? 'p-4 md:p-8' : 'p-8'}>
            {readOnlyNotice && (
              <p className="mb-6 rounded-md border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                {readOnlyNotice}
              </p>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
