import type { Metadata } from 'next'
import { Mail, Clock } from 'lucide-react'
import { CONTACT_EMAIL } from '@/lib/marketing/company'
import { buildMarketingMetadata } from '@/lib/marketing/seo'

export function generateMetadata(): Metadata {
  return buildMarketingMetadata({
    title: '문의 — Workdeck',
    description: 'Workdeck 이용 중 궁금한 점이나 제휴 문의는 이메일로 연락해 주세요.',
    path: '/contact',
    keywords: ['Workdeck 문의', 'Workdeck 고객센터'],
  })
}

export default function ContactPage() {
  return (
    <div className="w-full">
      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-2xl space-y-8 text-center">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl">문의</h1>
            <p className="mx-auto max-w-xl text-lg break-keep text-muted-foreground">
              서비스 이용 중 궁금한 점, 오류 제보, 제휴 문의 모두 아래 이메일로 보내주세요.
            </p>
          </div>

          <div className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border bg-card p-8">
            <div className="flex items-center justify-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" aria-hidden />
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-lg font-semibold hover:underline">
                {CONTACT_EMAIL}
              </a>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm break-keep text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" aria-hidden />
              영업일 기준 1~2일 이내 답변드립니다.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
