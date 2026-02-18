'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Switch } from '@/components/ui/switch'
import { Check, X } from 'lucide-react'
import { PricingCard } from '@/components/marketing/pricing-card'
import Link from 'next/link'

export default function PricingPage() {
  const [billingPeriod, setBillingPeriod] = useState<'month' | 'year'>('month')

  const plans = [
    {
      name: '무료',
      monthlyPrice: 0,
      yearlyPrice: 0,
      description: '시작하기에 좋습니다',
      features: [
        '1명 사용자',
        '3개 프로젝트',
        '1GB 저장 공간',
        '기본 대시보드',
        '월 1,000 API 호출',
        '커뮤니티 지원',
      ],
      ctaText: '무료 시작',
      ctaHref: '/signup',
    },
    {
      name: '프로',
      monthlyPrice: 50000,
      yearlyPrice: 500000,
      description: '성장하는 팀을 위해',
      features: [
        '10명 사용자',
        '무제한 프로젝트',
        '100GB 저장 공간',
        '고급 분석 & 리포트',
        '월 100,000 API 호출',
        '이메일 & 라이브 채팅 지원',
        '커스텀 대시보드',
        '데이터 내보내기',
      ],
      ctaText: '시작하기',
      ctaHref: '/signup',
      popular: true,
    },
    {
      name: '엔터프라이즈',
      monthlyPrice: undefined,
      yearlyPrice: undefined,
      description: '대규모 조직을 위해',
      features: [
        '무제한 사용자',
        '무제한 프로젝트',
        '무제한 저장 공간',
        '모든 기능',
        '무제한 API 호출',
        '우선 전담 지원',
        'SLA 보장 (99.99%)',
        '맞춤형 통합',
        '보안 감사',
      ],
      ctaText: '영업 문의',
      ctaHref: '/contact',
    },
  ]

  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-5xl sm:text-6xl font-bold">명확한 가격, 숨은 비용 없음</h1>
            <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400">
              팀의 규모에 상관없이 맞는 플랜을 찾으세요
            </p>
          </div>

          {/* 월간/연간 토글 */}
          <div className="flex items-center justify-center gap-4 bg-gray-100 dark:bg-gray-900 rounded-lg p-4 w-fit mx-auto">
            <span className={billingPeriod === 'month' ? 'font-semibold' : 'text-gray-600 dark:text-gray-400'}>
              월간 결제
            </span>
            <Switch
              checked={billingPeriod === 'year'}
              onCheckedChange={(checked) =>
                setBillingPeriod(checked ? 'year' : 'month')
              }
            />
            <div className="flex items-center gap-2">
              <span className={billingPeriod === 'year' ? 'font-semibold' : 'text-gray-600 dark:text-gray-400'}>
                연간 결제
              </span>
              {billingPeriod === 'year' && (
                <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-3 py-1 rounded-full font-semibold">
                  20% 할인
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            {plans.map((plan, index) => (
              <PricingCard
                key={index}
                name={plan.name}
                price={
                  plan.monthlyPrice === undefined
                    ? '맞춤형'
                    : billingPeriod === 'month'
                    ? plan.monthlyPrice
                    : plan.yearlyPrice
                }
                description={plan.description}
                features={plan.features}
                popular={plan.popular}
                ctaText={plan.ctaText}
                ctaHref={plan.ctaHref}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Features Comparison Table */}
      <section className="bg-gray-50 dark:bg-gray-900/50 px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold">전체 기능 비교</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-gray-800">
                  <th className="text-left py-4 px-4 font-semibold">기능</th>
                  <th className="text-center py-4 px-4 font-semibold">무료</th>
                  <th className="text-center py-4 px-4 font-semibold">프로</th>
                  <th className="text-center py-4 px-4 font-semibold">엔터프라이즈</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { feature: '사용자 수', free: '1명', pro: '10명', enterprise: '무제한' },
                  { feature: '프로젝트', free: '3개', pro: '무제한', enterprise: '무제한' },
                  { feature: '저장 공간', free: '1GB', pro: '100GB', enterprise: '무제한' },
                  { feature: 'API 호출/월', free: '1,000', pro: '100,000', enterprise: '무제한' },
                  { feature: '기본 대시보드', free: true, pro: true, enterprise: true },
                  { feature: '고급 분석', free: false, pro: true, enterprise: true },
                  { feature: '데이터 내보내기', free: false, pro: true, enterprise: true },
                  { feature: '커스텀 통합', free: false, pro: false, enterprise: true },
                  { feature: '우선 지원', free: false, pro: true, enterprise: true },
                  { feature: '전담 매니저', free: false, pro: false, enterprise: true },
                  { feature: 'SLA 보장', free: false, pro: false, enterprise: true },
                ].map((row, i) => (
                  <tr
                    key={i}
                    className="border-b dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800/50"
                  >
                    <td className="py-4 px-4 font-medium">{row.feature}</td>
                    <td className="text-center py-4 px-4">
                      {typeof row.free === 'boolean' ? (
                        row.free ? (
                          <Check className="h-5 w-5 text-green-600 mx-auto" />
                        ) : (
                          <X className="h-5 w-5 text-gray-400 mx-auto" />
                        )
                      ) : (
                        row.free
                      )}
                    </td>
                    <td className="text-center py-4 px-4">
                      {typeof row.pro === 'boolean' ? (
                        row.pro ? (
                          <Check className="h-5 w-5 text-green-600 mx-auto" />
                        ) : (
                          <X className="h-5 w-5 text-gray-400 mx-auto" />
                        )
                      ) : (
                        row.pro
                      )}
                    </td>
                    <td className="text-center py-4 px-4">
                      {typeof row.enterprise === 'boolean' ? (
                        row.enterprise ? (
                          <Check className="h-5 w-5 text-green-600 mx-auto" />
                        ) : (
                          <X className="h-5 w-5 text-gray-400 mx-auto" />
                        )
                      ) : (
                        row.enterprise
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing FAQ */}
      <section className="px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold">가격 관련 FAQ</h2>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {[
              {
                q: '연간 결제 시 얼마나 절약할 수 있나요?',
                a: '연간 결제는 월간 결제 총액에서 20%를 할인해드립니다. 예를 들어 프로 플랜의 경우 연 600,000원 대신 500,000원만 결제하면 됩니다.',
              },
              {
                q: '언제든지 플랜을 변경할 수 있나요?',
                a: '네, 언제든지 플랜을 변경할 수 있습니다. 같은 달에 업그레이드하면 차액만 청구되고, 다운그레이드하면 다음 달부터 적용됩니다.',
              },
              {
                q: '구독을 취소하면 어떻게 되나요?',
                a: '언제든지 구독을 취소할 수 있습니다. 결제 후 구독 취소 시 다음 결제일 전에 취소하면 다시 청구되지 않습니다.',
              },
              {
                q: '추가 사용자는 어떻게 추가하나요?',
                a: '설정에서 팀 멤버를 추가하면 자동으로 계산되어 월 청구액에 반영됩니다.',
              },
              {
                q: '교육 기관이나 비영리 단체에 할인이 있나요?',
                a: '네, 교육 기관과 비영리 단체는 50% 할인을 제공합니다. 영업팀에 문의해주세요.',
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

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-blue-600 to-purple-600 text-white px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl sm:text-5xl font-bold">완벽한 플랜을 찾으셨나요?</h2>
            <p className="text-lg text-blue-100">
              지금 바로 시작하세요. 신용카드 없이 무료로 체험할 수 있습니다.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" variant="secondary">
                지금 시작하기
              </Button>
            </Link>
            <Link href="/contact">
              <Button
                size="lg"
                variant="outline"
                className="text-white border-white hover:bg-white/20"
              >
                엔터프라이즈 플랜 문의
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
