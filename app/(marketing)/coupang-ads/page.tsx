import Link from 'next/link'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildAppUrl } from '@/lib/domain'

const points = [
  '쿠팡 광고 리포트 Excel 업로드 자동 파싱',
  '캠페인별 ROAS/광고비/클릭 시계열 분석',
  '비효율 키워드 즉시 탐색 및 운영 액션 지원',
]

export default function CoupangAdsLandingPage() {
  return (
    <div className="bg-gradient-to-b from-orange-50 to-white px-4 py-20 sm:px-6 lg:px-8 dark:from-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl border border-orange-100 bg-white p-8 shadow-sm sm:p-10 dark:border-orange-900/40 dark:bg-gray-900">
          <p className="text-sm font-semibold tracking-wide text-orange-600 uppercase">
            Coupang Ads
          </p>
          <h1 className="mt-3 text-3xl leading-tight font-bold text-slate-900 sm:text-4xl dark:text-slate-100">
            쿠팡 광고 관리자 Deck
          </h1>
          <p className="mt-4 max-w-3xl text-base text-slate-600 sm:text-lg dark:text-slate-300">
            Workdeck 안에서 쿠팡 광고 데이터를 업로드하고, 성과를 해석하고, 바로 운영 의사결정을
            실행하는 전용 Deck입니다.
          </p>

          <ul className="mt-8 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-2 text-slate-700 dark:text-slate-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
                <span>{point}</span>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href={buildAppUrl('/d/coupang-ads/login')}>
              <Button className="w-full gap-2 sm:w-auto">
                로그인하고 시작하기
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href={buildAppUrl('/signup')}>
              <Button variant="outline" className="w-full sm:w-auto">
                새 계정 만들기
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
