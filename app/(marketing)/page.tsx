'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Shield,
  Users,
  TrendingUp,
  Zap,
  Lock,
  Clock,
  Smartphone,
} from 'lucide-react'
import { FeatureCard } from '@/components/marketing/feature-card'
import { PricingCard } from '@/components/marketing/pricing-card'
import { TestimonialCard } from '@/components/marketing/testimonial-card'

export default function HomePage() {
  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="px-4 sm:px-6 lg:px-8 py-20 md:py-32">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* 신뢰 배지 */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border bg-blue-50 dark:bg-blue-950/30 px-4 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium">1000+ 기업이 신뢰합니다</span>
            </div>
          </div>

          {/* 헤드라인 */}
          <div className="space-y-4">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight">
              비즈니스 의사결정을 돕는
              <span className="block bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                완벽한 SaaS 플랫폼
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              실시간 데이터 분석, 구독 결제, 팀 협업까지 모든 기능이 준비된 엔터프라이즈급 SaaS 솔루션입니다.
            </p>
          </div>

          {/* CTA 버튼 */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Link href="/signup">
              <Button size="lg" className="gap-2">
                무료로 시작하기
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Button size="lg" variant="outline">
              데모 보기
            </Button>
          </div>

          {/* 통계 */}
          <div className="grid grid-cols-3 gap-4 pt-8 border-t border-gray-200 dark:border-gray-800">
            {[
              { value: '1000+', label: '활성 사용자' },
              { value: '99.9%', label: '가용성' },
              { value: '24/7', label: '고객 지원' },
            ].map((stat, i) => (
              <div key={i}>
                <p className="text-2xl sm:text-3xl font-bold">{stat.value}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="bg-gray-50 dark:bg-gray-900/50 px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="text-center space-y-4">
            <h2 className="text-4xl sm:text-5xl font-bold">강력한 기능</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              비즈니스 성장을 가속화하는 모든 도구를 한곳에서 관리하세요
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon={BarChart3}
              title="실시간 분석"
              description="직관적인 대시보드로 비즈니스 데이터를 실시간으로 분석하세요"
            />
            <FeatureCard
              icon={Users}
              title="팀 협업"
              description="팀원들과 쉽게 협업하고 프로젝트를 함께 관리합니다"
            />
            <FeatureCard
              icon={TrendingUp}
              title="자동화"
              description="반복적인 작업을 자동화하여 생산성을 극대화합니다"
            />
            <FeatureCard
              icon={Shield}
              title="보안"
              description="엔터프라이즈급 보안으로 데이터를 완벽히 보호합니다"
            />
            <FeatureCard
              icon={Zap}
              title="빠른 성능"
              description="초고속 로딩과 응답으로 최적의 경험을 제공합니다"
            />
            <FeatureCard
              icon={Lock}
              title="SSO/OAuth"
              description="다양한 인증 방식을 지원하여 접근성을 높입니다"
            />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl sm:text-5xl font-bold">어떻게 시작할까요?</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              3개의 간단한 단계로 시작하세요
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                title: '가입하기',
                description: '이메일로 계정을 만들고 프로필을 설정하세요',
              },
              {
                step: '2',
                title: '데이터 연결',
                description: '비즈니스 데이터를 안전하게 연결합니다',
              },
              {
                step: '3',
                title: '분석 시작',
                description: '실시간 대시보드로 분석을 시작합니다',
              },
            ].map((item, i) => (
              <div key={i} className="relative">
                <div className="flex flex-col items-center gap-4">
                  <div className="rounded-full bg-blue-600 text-white w-12 h-12 flex items-center justify-center text-lg font-bold">
                    {item.step}
                  </div>
                  <div className="text-center">
                    <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                    <p className="text-gray-600 dark:text-gray-400">{item.description}</p>
                  </div>
                </div>
                {i < 2 && (
                  <div className="hidden md:block absolute top-6 -right-8 text-gray-300">
                    <ArrowRight className="h-6 w-6" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Preview Section */}
      <section id="pricing" className="bg-gray-50 dark:bg-gray-900/50 px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl sm:text-5xl font-bold">명확한 가격</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              모든 비즈니스 규모를 위한 유연한 가격 옵션
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <PricingCard
              name="무료"
              price={0}
              description="시작하기에 좋습니다"
              features={['기본 대시보드', '1명 사용자', '1GB 저장 공간']}
              ctaText="무료 시작"
              ctaHref="/signup"
            />
            <PricingCard
              name="프로"
              price={50000}
              description="성장하는 팀을 위해"
              features={['고급 분석', '10명 사용자', '100GB 저장 공간', '우선 지원']}
              popular={true}
              ctaText="시작하기"
              ctaHref="/signup"
            />
            <PricingCard
              name="엔터프라이즈"
              price="맞춤형"
              description="대규모 조직을 위해"
              features={['모든 기능', '무제한 사용자', '무제한 저장 공간', '전담 매니저']}
              ctaText="영업 문의"
              ctaHref="/contact"
            />
          </div>

          <div className="text-center pt-8">
            <Link href="/pricing">
              <Button variant="outline" size="lg">
                전체 가격 정보 보기
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl sm:text-5xl font-bold">고객의 목소리</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              이미 많은 기업이 우리 플랫폼으로 성공하고 있습니다
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <TestimonialCard
              name="김철수"
              title="CEO"
              company="테크스타트업"
              text="데이터 분석이 이렇게 간단할 수 있다는 게 놀라웠습니다. 팀의 생산성이 30% 향상되었어요."
              rating={5}
            />
            <TestimonialCard
              name="이영희"
              title="운영 총괄"
              company="이커머스 회사"
              text="고객 지원이 정말 훌륭합니다. 24시간 이내에 모든 문제가 해결되었어요."
              rating={5}
            />
            <TestimonialCard
              name="박준호"
              title="데이터 담당자"
              company="금융회사"
              text="보안과 규정 준수가 완벽하게 구현되어 있습니다. 신뢰할 수 있는 파트너입니다."
              rating={5}
            />
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="bg-gradient-to-br from-blue-600 to-purple-600 text-white px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 text-center">
            {[
              { value: '50K+', label: '활성 사용자' },
              { value: '500+', label: '엔터프라이즈 고객' },
              { value: '1B+', label: '월간 데이터 포인트' },
              { value: '99.99%', label: '가용성' },
            ].map((stat, i) => (
              <div key={i}>
                <p className="text-4xl sm:text-5xl font-bold">{stat.value}</p>
                <p className="text-blue-100 mt-2">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-3xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl sm:text-5xl font-bold">자주 묻는 질문</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              더 궁금한 점이 있으신가요?
            </p>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {[
              {
                q: '무료 플랜은 언제까지 사용할 수 있나요?',
                a: '무료 플랜은 영구적으로 사용할 수 있습니다. 필요에 따라 언제든지 유료 플랜으로 업그레이드할 수 있습니다.',
              },
              {
                q: '데이터 보안은 어떻게 보장되나요?',
                a: 'AWS의 엔터프라이즈급 인프라와 256비트 AES 암호화를 사용하여 모든 데이터를 보호합니다. SOC 2 Type II 인증을 받았습니다.',
              },
              {
                q: '다른 도구와 연동할 수 있나요?',
                a: '네, 100+ 이상의 인기 도구와 통합할 수 있습니다. REST API와 Webhook도 지원합니다.',
              },
              {
                q: '플랜을 변경할 수 있나요?',
                a: '네, 언제든지 플랜을 변경할 수 있습니다. 같은 달에 변경하면 차액만 청구됩니다.',
              },
              {
                q: '기술 지원은 어떻게 받을 수 있나요?',
                a: '무료 플랜은 이메일 지원, 프로/엔터프라이즈는 우선 지원과 라이브 채팅을 제공합니다.',
              },
              {
                q: '계약 약정이 필요한가요?',
                a: '아니요, 월별 구독이므로 언제든지 취소할 수 있습니다. 엔터프라이즈는 별도의 계약 옵션이 있습니다.',
              },
            ].map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border-gray-200 dark:border-gray-800">
                <AccordionTrigger className="text-left font-semibold">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 dark:text-gray-400">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="bg-gradient-to-br from-blue-600 to-purple-600 text-white px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl sm:text-5xl font-bold">오늘부터 시작하세요</h2>
            <p className="text-lg text-blue-100">
              신용카드 없이 5분 안에 가입할 수 있습니다.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup">
              <Button
                size="lg"
                variant="secondary"
                className="gap-2"
              >
                무료로 시작하기
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/contact">
              <Button
                size="lg"
                variant="outline"
                className="text-white border-white hover:bg-white/20"
              >
                영업팀에 문의하기
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
