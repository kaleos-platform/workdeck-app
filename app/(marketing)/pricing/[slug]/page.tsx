import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { JsonLd } from '@/components/marketing/json-ld'
import { buildAppUrl } from '@/lib/domain'
import { DECK_META } from '@/lib/deck-meta'
import { COMPANY, CONTACT_EMAIL } from '@/lib/marketing/company'
import { DECK_LANDINGS } from '@/lib/marketing/decks'
import { DECK_PRICING_BY_SLUG } from '@/lib/marketing/pricing-data'
import { MARKETING_DECK_SLUGS, type MarketingDeckSlugString } from '@/lib/marketing/routes'
import { buildMarketingMetadata, breadcrumbJsonLd, productJsonLd } from '@/lib/marketing/seo'

interface ProductPageProps {
  params: Promise<{ slug: string }>
}

function isDeckSlug(value: string): value is MarketingDeckSlugString {
  return (MARKETING_DECK_SLUGS as readonly string[]).includes(value)
}

export function generateStaticParams() {
  return MARKETING_DECK_SLUGS.map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params
  if (!isDeckSlug(slug)) return {}

  const row = DECK_PRICING_BY_SLUG[slug]
  return buildMarketingMetadata({
    title: `${row.name} 구독 — Workdeck`,
    description: `${row.name} 업무 모듈 월 ${row.totalPrice.toLocaleString('ko-KR')}원(VAT 포함). ${row.summary}`,
    path: `/pricing/${slug}`,
    keywords: [`${row.name} 요금`, `${row.name} 구독`, 'Workdeck 구독'],
  })
}

/** 상품 필수 표기 — 전자상거래법·PG 심사 항목과 1:1 대응 */
function buildSpecs(price: number) {
  return [
    { label: '상품 종류', value: '온라인 소프트웨어(SaaS) 이용권 — 월 구독' },
    {
      label: '판매 가격',
      value: `월 ${price.toLocaleString('ko-KR')}원 (부가세 포함)`,
    },
    { label: '이용 기간', value: '결제일로부터 1개월. 해지 신청 전까지 매월 자동 갱신' },
    {
      label: '공급 시기·방법',
      value:
        '결제 완료 즉시 워크스페이스에서 해당 업무 모듈이 활성화됩니다. 온라인으로 제공되는 서비스로 별도의 재화 배송은 없습니다.',
    },
    { label: '결제 수단', value: '신용카드·체크카드 자동결제 (토스페이먼츠)' },
    { label: '이용 환경', value: '웹 브라우저 (별도 설치 프로그램 없음)' },
    { label: '최소 구독 수량', value: '워크스페이스당 업무 모듈 1개부터' },
  ]
}

export default async function DeckProductPage({ params }: ProductPageProps) {
  const { slug } = await params
  if (!isDeckSlug(slug)) notFound()

  const row = DECK_PRICING_BY_SLUG[slug]
  const landing = DECK_LANDINGS[slug]
  const meta = DECK_META[slug]
  const Icon = meta.icon
  const specs = buildSpecs(row.totalPrice)

  return (
    <div className="w-full">
      <JsonLd
        data={productJsonLd({
          slug,
          name: `${row.name} 구독`,
          description: row.summary,
          price: row.totalPrice,
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '요금제', path: '/pricing' },
          { name: row.name, path: `/pricing/${slug}` },
        ])}
      />

      {/* 상품 개요 */}
      <section className="px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br ${meta.gradient}`}
              >
                <Icon className="h-6 w-6 text-white" aria-hidden />
              </div>
              <Badge variant="outline" className="text-emerald-600">
                판매 중
              </Badge>
            </div>
            <div className="space-y-3">
              <h1 className="text-3xl font-bold tracking-tight break-keep sm:text-4xl">
                {row.name} 구독
              </h1>
              <p className="text-lg break-keep text-muted-foreground">{row.summary}</p>
            </div>

            <ul className="space-y-2">
              {landing.features.slice(0, 5).map((feature) => (
                <li key={feature.title} className="flex gap-2 text-sm break-keep">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  <span>
                    <span className="font-medium">{feature.title}</span> — {feature.description}
                  </span>
                </li>
              ))}
            </ul>

            <Link
              href={`/${slug}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 hover:gap-1.5"
            >
              {row.name} 기능 자세히 보기
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>

          {/* 구매 카드 */}
          <div className="h-fit space-y-4 rounded-xl border bg-card p-6">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">월 구독료 (부가세 포함)</p>
              <p className="text-3xl font-bold">{row.totalPrice.toLocaleString('ko-KR')}원</p>
              <p className="text-sm text-muted-foreground">
                공급가 {row.supplyPrice.toLocaleString('ko-KR')}원 + 부가세{' '}
                {(row.totalPrice - row.supplyPrice).toLocaleString('ko-KR')}원
              </p>
            </div>
            <Link href={buildAppUrl('/settings/billing')} className="block">
              <Button size="lg" className="w-full gap-2">
                구독 신청하기
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
            <p className="text-xs break-keep text-muted-foreground">
              구독 신청은 워크스페이스 로그인 후 [설정 &gt; 결제] 에서 진행됩니다. 결제 수단(카드)
              등록 후 즉시 이용할 수 있습니다.
            </p>
          </div>
        </div>
      </section>

      {/* 상품 정보 고시 */}
      <section className="border-t bg-muted/30 px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <h2 className="text-xl font-bold break-keep">상품 정보 고시</h2>
          <dl className="divide-y rounded-xl border bg-card">
            {specs.map((spec) => (
              <div key={spec.label} className="grid gap-1 p-4 sm:grid-cols-[180px_1fr] sm:gap-4">
                <dt className="text-sm font-medium break-keep">{spec.label}</dt>
                <dd className="text-sm break-keep text-muted-foreground">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* 취소·환불 + 판매자 정보 */}
      <section className="px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-2">
          <div className="space-y-3 rounded-xl border p-6">
            <h2 className="font-semibold break-keep">취소·환불 안내</h2>
            <ul className="space-y-2 text-sm break-keep text-muted-foreground">
              <li>
                • 결제일로부터 7일 이내, 서비스를 이용하지 않은 경우 전액 환불(청약철회)이
                가능합니다.
              </li>
              <li>
                • 다만 데이터 업로드·분석 실행·콘텐츠 생성 등 서비스의 핵심 기능을 실질적으로 이용한
                경우에는 「전자상거래법」 제17조 제2항에 따라 청약철회가 제한될 수 있습니다.
              </li>
              <li>
                • 구독 해지를 신청하면 이미 결제한 이용 기간의 마지막 날까지 이용할 수 있으며, 다음
                주기부터 결제되지 않습니다.
              </li>
              <li>
                • 회사 귀책 사유로 서비스를 이용하지 못한 경우 해당 기간만큼 환불 또는 이용 기간
                연장을 제공합니다.
              </li>
            </ul>
            <Link
              href="/refund"
              className="inline-flex items-center gap-1 text-sm font-medium hover:gap-1.5"
            >
              취소·환불 규정 전문 보기
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>

          <div className="space-y-2 rounded-xl border p-6 text-sm break-keep text-muted-foreground">
            <h2 className="font-semibold text-foreground">판매자 정보</h2>
            <p>상호: {COMPANY.name}</p>
            <p>대표자: {COMPANY.ceo}</p>
            <p>사업자등록번호: {COMPANY.registrationNumber}</p>
            <p>통신판매업신고번호: {COMPANY.mailOrderNumber}</p>
            <p>주소: {COMPANY.address}</p>
            <p>
              고객센터:{' '}
              <a href={`tel:${COMPANY.phone}`} className="hover:underline">
                {COMPANY.phone}
              </a>
            </p>
            <p>
              이메일:{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="hover:underline">
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
