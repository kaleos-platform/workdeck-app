import type { ReactNode } from 'react'

// 홈 대시보드 도메인 섹션 그룹 (판매 / 재고 / 배송 / 운영).
// 제목 + 카드 그리드. 사이드바 섹션 구조와 일관된 그룹핑.

export function HomeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}
