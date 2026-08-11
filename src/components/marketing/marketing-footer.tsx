import Link from 'next/link'
import { LayoutGrid } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { DECK_META } from '@/lib/deck-meta'
import { COMPANY, CONTACT_EMAIL } from '@/lib/marketing/company'
import { MARKETING_DECK_SLUGS } from '@/lib/marketing/routes'

const companyLinks = [
  { label: '소개', href: '/about' },
  { label: '블로그', href: '/blog' },
  { label: '문의', href: '/contact' },
  { label: '이용약관', href: '/terms' },
  { label: '개인정보처리방침', href: '/privacy' },
]

export function MarketingFooter() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-3">
          {/* 브랜드 */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-blue-600 to-cyan-500">
                <LayoutGrid className="h-5 w-5 text-white" aria-hidden />
              </div>
              <span className="font-bold">Workdeck</span>
            </div>
            <p className="text-sm break-keep text-muted-foreground">
              여러 비즈니스 업무를 필요한 것만 골라 쓰는 올인원 워크스페이스
            </p>
          </div>

          {/* 업무 링크 */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">업무</h3>
            <ul className="space-y-2">
              {MARKETING_DECK_SLUGS.map((slug) => (
                <li key={slug}>
                  <Link
                    href={`/${slug}`}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {DECK_META[slug].name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 회사 링크 */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">회사</h3>
            <ul className="space-y-2">
              {companyLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="space-y-1 text-xs break-keep text-muted-foreground">
          <p>
            {COMPANY.name} | 대표: {COMPANY.ceo} | 사업자등록번호: {COMPANY.registrationNumber}
          </p>
          <p>
            주소: {COMPANY.address} | 문의:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="transition-colors hover:text-foreground">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          &copy; {currentYear} Workdeck. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
