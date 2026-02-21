import { BarChart2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

export function MarketingFooter() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t bg-gray-50 dark:bg-gray-900/50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* 브랜드 */}
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-orange-500 to-red-600">
            <BarChart2 className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold">쿠팡 광고 매니저</span>
        </div>
        <p className="mb-8 text-sm text-gray-600 dark:text-gray-400">
          쿠팡 광고비를 분석하고 ROAS를 개선하세요
        </p>

        <Separator className="my-8" />

        {/* 하단 정보 */}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          &copy; {currentYear} 쿠팡 광고 매니저. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
