'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { buildAppUrl } from '@/lib/domain'
import { BarChart2 } from 'lucide-react'

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* 로고 */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-orange-500 to-red-600">
            <BarChart2 className="h-5 w-5 text-white" />
          </div>
          <span className="hidden text-xl font-bold sm:inline">쿠팡 광고 매니저</span>
        </Link>

        {/* CTA 버튼 */}
        <div className="flex items-center gap-4">
          <Link href={buildAppUrl('/login')} className="hidden sm:block">
            <Button variant="ghost">로그인</Button>
          </Link>
          <Link href={buildAppUrl('/signup')}>
            <Button>무료 시작</Button>
          </Link>
        </div>
      </div>
    </header>
  )
}
