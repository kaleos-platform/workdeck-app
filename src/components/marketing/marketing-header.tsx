'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { buildAppUrl } from '@/lib/domain'
import { DECK_META } from '@/lib/deck-meta'
import { MARKETING_DECK_SLUGS } from '@/lib/marketing/routes'

export function MarketingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* 로고 */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-blue-600 to-cyan-500">
            <LayoutGrid className="h-5 w-5 text-white" aria-hidden />
          </div>
          <span className="text-xl font-bold">Workdeck</span>
        </Link>

        {/* 데스크톱 네비 */}
        <nav className="hidden items-center gap-6 md:flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                Deck
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {MARKETING_DECK_SLUGS.map((slug) => {
                const meta = DECK_META[slug]
                const Icon = meta.icon
                return (
                  <DropdownMenuItem key={slug} asChild>
                    <Link href={`/${slug}`} className="flex items-center gap-2">
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded bg-gradient-to-br ${meta.gradient}`}
                      >
                        <Icon className="h-3.5 w-3.5 text-white" aria-hidden />
                      </div>
                      <span>{meta.name}</span>
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link
            href="/pricing"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            요금제
          </Link>
          <Link
            href="/blog"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            블로그
          </Link>
        </nav>

        {/* CTA 버튼 */}
        <div className="hidden items-center gap-3 md:flex">
          <Link href={buildAppUrl('/login')}>
            <Button variant="ghost">로그인</Button>
          </Link>
          <Link href={buildAppUrl('/signup')}>
            <Button>무료 시작</Button>
          </Link>
        </div>

        {/* 모바일 토글 */}
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center md:hidden"
          aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((prev) => !prev)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* 모바일 메뉴 */}
      {mobileOpen ? (
        <nav className="border-t bg-background px-4 py-4 md:hidden">
          <ul className="space-y-1">
            {MARKETING_DECK_SLUGS.map((slug) => (
              <li key={slug}>
                <Link
                  href={`/${slug}`}
                  className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                  onClick={() => setMobileOpen(false)}
                >
                  {DECK_META[slug].name}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/pricing"
                className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileOpen(false)}
              >
                요금제
              </Link>
            </li>
            <li>
              <Link
                href="/blog"
                className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileOpen(false)}
              >
                블로그
              </Link>
            </li>
          </ul>
          <div className="mt-4 flex flex-col gap-2">
            <Link href={buildAppUrl('/login')}>
              <Button variant="outline" className="w-full">
                로그인
              </Button>
            </Link>
            <Link href={buildAppUrl('/signup')}>
              <Button className="w-full">무료 시작</Button>
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  )
}
