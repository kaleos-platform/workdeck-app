import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { UploadCloud, TrendingUp, Search, ArrowRight } from 'lucide-react'

const features = [
  {
    icon: UploadCloud,
    title: 'Excel 리포트 업로드',
    description:
      '쿠팡 광고 리포트 Excel 파일을 업로드하면 자동으로 파싱하여 분석 데이터로 변환합니다.',
  },
  {
    icon: TrendingUp,
    title: 'ROAS 시계열 분석',
    description:
      '캠페인별 ROAS, 광고비, 클릭수, 노출수를 날짜별로 추이를 확인하고 성과를 파악합니다.',
  },
  {
    icon: Search,
    title: '비효율 키워드 발견',
    description: '광고비가 지출됐지만 주문이 없는 키워드를 자동으로 필터링해 한 번에 복사합니다.',
  },
]

export default function HomePage() {
  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="px-4 py-20 sm:px-6 md:py-32 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-8 text-center">
          <div className="space-y-4">
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              쿠팡 광고비 낭비를
              <span className="block bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent">
                멈추세요
              </span>
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-gray-600 sm:text-xl dark:text-gray-400">
              쿠팡 광고 리포트 Excel을 업로드하면 비효율 키워드를 자동으로 발견하고 ROAS 개선을 위한
              인사이트를 제공합니다.
            </p>
          </div>

          <div className="flex flex-col justify-center gap-4 pt-4 sm:flex-row">
            <Link href="/signup">
              <Button size="lg" className="gap-2">
                무료로 시작하기
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">
                로그인
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-gray-50 px-4 py-20 sm:px-6 lg:px-8 dark:bg-gray-900/50">
        <div className="mx-auto max-w-6xl space-y-12">
          <div className="space-y-4 text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">주요 기능</h2>
            <p className="mx-auto max-w-2xl text-lg text-gray-600 dark:text-gray-400">
              광고 운영자가 꼭 필요한 핵심 분석 기능만 담았습니다
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon
              return (
                <Card key={feature.title}>
                  <CardContent className="pt-6">
                    <div className="flex flex-col gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                        <Icon className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div>
                        <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                          {feature.description}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-12">
          <div className="space-y-4 text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">3단계로 시작하세요</h2>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                step: '1',
                title: '회원가입',
                description: '이메일로 계정을 만들고 쿠팡 사업자명으로 워크스페이스를 생성합니다',
              },
              {
                step: '2',
                title: 'Excel 업로드',
                description: '쿠팡 셀러센터에서 다운로드한 광고 리포트 Excel 파일을 업로드합니다',
              },
              {
                step: '3',
                title: '분석 시작',
                description: '캠페인별 ROAS 추이와 비효율 키워드를 바로 확인합니다',
              },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-600 text-lg font-bold text-white">
                  {item.step}
                </div>
                <div>
                  <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-orange-500 to-red-600 px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-8 text-center">
          <div className="space-y-4">
            <h2 className="text-3xl font-bold sm:text-4xl">지금 바로 광고비 낭비를 찾아내세요</h2>
            <p className="text-lg text-orange-100">무료로 시작할 수 있습니다.</p>
          </div>
          <Link href="/signup">
            <Button size="lg" variant="secondary" className="gap-2">
              무료로 시작하기
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  )
}
