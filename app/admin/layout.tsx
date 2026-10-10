import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { requireOperator } from '@/lib/admin/auth'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'
import { ThemeToggle } from '@/components/theme-toggle'
import { AdminUserMenu } from '@/components/admin/admin-user-menu'

// 기능 네비만 둔다. 계정 설정은 개인 설정이라 성격이 달라 우측 사용자 메뉴로 뺐다.
const NAV_ITEMS = [
  { href: '/admin', label: '대시보드' },
  { href: '/admin/users', label: '사용자' },
  { href: '/admin/billing', label: '결제' },
  { href: '/admin/templates', label: '템플릿' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const result = await requireOperator()
  if (!result.ok && result.reason === 'NOT_OPERATOR') {
    notFound()
  }
  if (!result.ok && result.reason === 'MFA_REQUIRED') {
    redirect(mfaStepUpPath('/admin'))
  }

  const email = result.user.email

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold">워크덱 운영 어드민</span>
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
        </div>
        <div className="flex items-center gap-1">
          <AdminUserMenu email={email} />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
