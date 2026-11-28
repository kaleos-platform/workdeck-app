import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  CalendarX,
  CheckCircle2,
  Gift,
  Lock,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { buildMarketingUrl } from '@/lib/domain'
import { MARKETING_CTA_CLASS } from '@/components/marketing/cta-class'

const SECTION = 'px-4 py-16 sm:px-6 sm:py-24 lg:px-8'
const H2 = 'text-2xl font-bold break-keep sm:text-3xl'

function CtaButton({ className = '' }: { className?: string }) {
  return (
    <Button asChild size="lg" className={`${MARKETING_CTA_CLASS} ${className}`}>
      <Link href={buildMarketingUrl('/recruiting#lead-form')}>
        도입 문의하기
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </Button>
  )
}

export function HomeHero() {
  return (
    <section className={SECTION}>
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div className="space-y-6">
          <p className="text-sm font-medium break-keep text-muted-foreground">
            작은 가게·회사 사장님을 위한 업무 도구
          </p>
          <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl">
            사장님 업무, 필요한 것만 골라 한 곳에서
          </h1>
          <p className="text-base break-keep text-muted-foreground">
            공고 만들기·지원자 관리부터 시작하고, 필요한 업무를 하나씩 더해 가세요. 쓰던 AI와
            연결하면 반복되는 일은 더 줄어듭니다.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <CtaButton className="w-full sm:w-auto" />
            <span className="text-sm text-muted-foreground">7일 무료 체험</span>
          </div>
        </div>
        <Image
          src="/marketing/recruiting/applicants.webp"
          alt="모집 관리에서 공고별 지원자를 한 목록으로 보는 화면"
          width={1600}
          height={1000}
          priority
          className="h-auto w-full rounded-xl border shadow-sm"
        />
      </div>
    </section>
  )
}

const TRUST: { icon: LucideIcon; text: string }[] = [
  { icon: Gift, text: '7일 무료 체험' },
  { icon: CalendarX, text: '언제든 해지' },
  { icon: ShieldCheck, text: 'AI 권한은 업무별로 따로' },
  { icon: Lock, text: '지원자 개인정보는 AI로 보내지 않음' },
]

export function HomeTrustBar() {
  return (
    <section className="border-y bg-muted/40 px-4 py-6 sm:px-6 lg:px-8">
      <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-4 lg:grid-cols-4">
        {TRUST.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2 text-sm break-keep">
            <Icon className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
            {text}
          </li>
        ))}
      </ul>
    </section>
  )
}

const PROBLEMS = [
  {
    before: '카톡·문자·메일로 따로 받던 지원서',
    after: '지원자가 한 목록에 모여요',
    desc: '워크덱 지원서로 받으면 공고별로 지원자를 바로 확인하고 상태를 관리할 수 있어요.',
  },
  {
    before: '공고 만들 때마다 처음부터',
    after: '템플릿으로 빠르게 공고 완성',
    desc: '디자인을 몰라도 템플릿을 골라 내용만 바꾸면 됩니다.',
  },
  {
    before: '엑셀·메모로 따로 챙기는 재고·장부',
    after: '같은 곳에서 관리하도록 준비 중',
    desc: '재고·장부 같은 업무도 순서대로 열립니다.',
    preparing: true,
  },
]

export function HomeProblems() {
  return (
    <section className={SECTION}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 space-y-2 text-center">
          <h2 className={H2}>반복되고 흩어진 일, 한 곳에서 정리</h2>
          <p className="break-keep text-muted-foreground">
            매번 같은 일을 다시 하고, 여기저기 흩어진 정보를 모으느라 시간을 쓰고 계신가요?
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div key={p.before} className="space-y-2 rounded-xl border bg-card p-6">
              <p className="text-sm break-keep text-muted-foreground">이전: {p.before}</p>
              <h3 className="text-lg font-semibold break-keep">{p.after}</h3>
              <p className="text-sm break-keep text-muted-foreground">{p.desc}</p>
              {p.preparing && <Badge variant="secondary">준비중</Badge>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const AI_POINTS = [
  '업무마다 AI가 볼 수 있는 것·할 수 있는 것을 따로 정할 수 있어요',
  'AI가 만든 공고는 「작성 중」으로 저장되고, 게시는 사장님이 직접 해요',
  '지원자 이름·연락처 같은 개인정보는 AI에 보내지 않아요',
  'AI 없이도 모든 기능을 쓸 수 있어요',
]

export function HomeAi() {
  return (
    <section className={`${SECTION} border-t`}>
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div className="space-y-6">
          <p className="text-sm font-medium text-blue-600">AI 활용</p>
          <h2 className={H2}>쓰던 AI로 일을 더 빨리</h2>
          <p className="text-base break-keep text-muted-foreground">
            Claude·ChatGPT 같은 AI를 연결하면 지원 현황을 물어보고 새 공고 초안을 맡길 수 있습니다.
          </p>
          <ul className="space-y-2">
            {AI_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2 text-base break-keep">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden />
                {point}
              </li>
            ))}
          </ul>
          <Link href="/recruiting" className="inline-flex items-center gap-1 text-sm font-medium">
            모집 관리 자세히 보기
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <Image
          src="/marketing/recruiting/ai.webp"
          alt="AI 대화에서 지원 현황을 조회하고 공고 초안 작성을 맡기는 예시"
          width={1600}
          height={1000}
          className="h-auto w-full rounded-xl border shadow-sm"
        />
      </div>
    </section>
  )
}

const STEPS = [
  { title: '도입 문의 남기기', desc: '간단한 정보를 남겨 주세요.' },
  { title: '안내 메일 받고 가입', desc: '7일 동안 무료로 써 보세요.' },
  { title: '필요한 업무만 구독', desc: '월 단위로 쓰고, 언제든 해지할 수 있어요.' },
]

export function HomeSteps() {
  return (
    <section className={`${SECTION} border-t`}>
      <div className="mx-auto max-w-6xl">
        <h2 className={`${H2} mb-12 text-center`}>시작은 이렇게 간단해요</h2>
        <ol className="grid gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="space-y-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 font-semibold text-blue-600">
                {i + 1}
              </span>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold break-keep">{step.title}</h3>
                <p className="text-sm break-keep text-muted-foreground">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function HomeFinalCta() {
  return (
    <section className="bg-blue-50 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6 text-center">
        <h2 className={H2}>지금 필요한 업무부터 시작해 보세요</h2>
        <p className="break-keep text-muted-foreground">
          7일 무료 체험으로 먼저 써 보고 결정하세요.
        </p>
        <CtaButton />
      </div>
    </section>
  )
}
