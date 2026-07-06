import type { ReactNode } from 'react'

// 공개 채용 공고 — deck 셸 없이 독립 레이아웃(무인증 접근).
// 디자인 토큰은 앱과 동일(중립 베이스 + 다크 모드 지원).
export default function PublicPostingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">{children}</div>
    </div>
  )
}
