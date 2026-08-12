import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireOperator } from '@/lib/admin/auth'
import { ThemeToggle } from '@/components/theme-toggle'

const NAV_ITEMS = [
  { href: '/admin', label: '대시보드' },
  { href: '/admin/users', label: '사용자' },
  { href: '/admin/billing', label: '결제' },
  { href: '/admin/templates', label: '템플릿' },
  { href: '/admin/account', label: '계정' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const result = await requireOperator()
  if (!result.ok && result.reason === 'NOT_OPERATOR') {
    notFound()
  }

  // 이 시점에서 result는 ok:true 또는 reason:'MFA_REQUIRED' 둘 중 하나 — 둘 다 user를 가짐
  const email = result.user.email
  const mfaRequired = !result.ok

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold">워크덱 운영 어드민</span>
          {!mfaRequired && (
            <nav className="flex items-center gap-4">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{email}</span>
          <ThemeToggle />
        </div>
      </header>
      {mfaRequired && (
        <div className="border-b bg-amber-50 px-6 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          2단계 인증(MFA) 등록이 필요합니다.{' '}
          <Link href="/admin/account" className="font-medium underline underline-offset-2">
            지금 등록하기
          </Link>
        </div>
      )}
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
