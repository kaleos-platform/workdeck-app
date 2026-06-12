import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import type { DeckVariant } from '@/lib/deck-meta'

type DeckShellProps = {
  workspaceName: string
  variant: DeckVariant
  mode?: 'default' | 'my-deck'
  activeDecks?: Array<{ id: string; name: string }>
  /** sales-content 등 deck-scoped CSS(`[data-deck='...']`)가 필요한 경우 전달 */
  dataDeck?: string
  children: React.ReactNode
}

/**
 * 모든 deck이 공유하는 앱 셸.
 * 전체 높이 사이드바(로고 상단) + 우측 컬럼(헤더 + 본문) 구조.
 * 향후 새 deck은 layout에서 이 컴포넌트만 사용하면 동일한 UI가 적용된다.
 */
export function DeckShell({
  workspaceName,
  variant,
  mode,
  activeDecks,
  dataDeck,
  children,
}: DeckShellProps) {
  return (
    <div className="flex h-screen" data-deck={dataDeck}>
      <Sidebar
        workspaceName={workspaceName}
        variant={variant}
        mode={mode}
        activeDecks={activeDecks}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header variant={variant} />
        <main className="flex-1 overflow-y-auto">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
