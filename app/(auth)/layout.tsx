import { BarChart2 } from 'lucide-react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-orange-50 to-red-50 px-4 dark:from-gray-950 dark:to-gray-900">
      <div className="w-full max-w-md">
        {/* 로고 및 타이틀 */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-gradient-to-br from-orange-500 to-red-600">
              <BarChart2 className="h-7 w-7 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">쿠팡 광고 매니저</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            광고 리포트 분석으로 ROAS를 높이세요
          </p>
        </div>

        {/* 콘텐츠 */}
        {children}
      </div>
    </div>
  )
}
