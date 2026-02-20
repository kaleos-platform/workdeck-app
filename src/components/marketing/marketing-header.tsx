'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BarChart2 } from 'lucide-react'

export function MarketingHeader() {
  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* 로고 */}
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
            <BarChart2 className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold text-xl hidden sm:inline">쿠팡 광고 매니저</span>
        </Link>

        {/* CTA 버튼 */}
        <div className="flex items-center gap-4">
          <Link href="/login" className="hidden sm:block">
            <Button variant="ghost">로그인</Button>
          </Link>
          <Link href="/signup">
            <Button>무료 시작</Button>
          </Link>
        </div>
      </div>
    </header>
  )
}
