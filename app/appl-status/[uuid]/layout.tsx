import type { ReactNode } from 'react'

// 지원 상태 공개열람 — 독립 레이아웃(무인증, 토큰 기반).
export default function ApplStatusLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-md px-4 py-12">{children}</div>
    </div>
  )
}
