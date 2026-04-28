'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import type { RuleStatus, RuleScope, RuleSource } from '@/generated/prisma/enums'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProductList } from '@/components/sc/settings/product-list'
import { PersonaList } from '@/components/sc/settings/persona-list'
import { BrandProfileForm } from '@/components/sc/settings/brand-profile-form'
import { ChannelForm } from '@/components/sc/channels/channel-form'
import { RuleList } from '@/components/sc/rules/rule-list'
import { RuleForm } from '@/components/sc/rules/rule-form'
import { AiInsightButton } from '@/components/sc/rules/ai-insight-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  SALES_CONTENT_PRODUCTS_PATH,
  SALES_CONTENT_PERSONAS_PATH,
  SALES_CONTENT_CHANNELS_PATH,
} from '@/lib/deck-routes'

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

type Product = {
  id: string
  name: string
  slug: string
  oneLinerPitch: string | null
  isActive: boolean
  updatedAt: Date
}

type Persona = {
  id: string
  name: string
  slug: string
  jobTitle: string | null
  industry: string | null
  companySize: string | null
  isActive: boolean
  updatedAt: Date
}

type BrandProfileInitial =
  | {
      companyName: string
      shortDescription: string
      missionStatement: string
      toneOfVoice: string[]
      forbiddenPhrases: string[]
      preferredPhrases: string[]
      styleGuideUrl: string
      primaryColor: string
      secondaryColor: string
      logoUrl: string
    }
  | undefined

type Channel = {
  id: string
  name: string
  platform: string
  kind: string
  platformSlug: string
  isActive: boolean
  publisherMode: string
  collectorMode: string
}

type Rule = {
  id: string
  scope: RuleScope
  source: RuleSource
  title: string
  body: string
  status: RuleStatus
  weight: number
  updatedAt: Date
}

type Props = {
  products: Product[]
  personas: Persona[]
  brandProfileInitial: BrandProfileInitial
  channels: Channel[]
  rules: Rule[]
}

// ─── 채널 플랫폼 레이블 ──────────────────────────────────────────────────────

const PLATFORM_LABEL: Record<string, string> = {
  BLOG_NAVER: '네이버 블로그',
  BLOG_TISTORY: '티스토리',
  BLOG_WORDPRESS: '워드프레스',
  THREADS: 'Threads',
  X: 'X',
  LINKEDIN: 'LinkedIn',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  YOUTUBE_SHORTS: 'YouTube Shorts',
  OTHER: '기타',
}

// ─── 세일즈 정보 서브섹션 ─────────────────────────────────────────────────────

function SalesInfoTab({
  products,
  personas,
  brandProfileInitial,
}: {
  products: Product[]
  personas: Persona[]
  brandProfileInitial: BrandProfileInitial
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const section = searchParams.get('section') ?? 'products'

  const setSection = useCallback(
    (s: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('tab', 'sales-info')
      params.set('section', s)
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  return (
    <div className="space-y-6">
      {/* 서브 탭 — 판매 상품 / 타겟 페르소나 / 브랜드 프로필 */}
      <div className="flex gap-2 border-b">
        {(['products', 'personas', 'brand-profile'] as const).map((s) => {
          const labels: Record<string, string> = {
            products: '판매 상품',
            personas: '타겟 페르소나',
            'brand-profile': '브랜드 프로필',
          }
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                section === s
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {labels[s]}
            </button>
          )
        })}
      </div>

      {/* 판매 상품 */}
      {section === 'products' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">판매 상품</h2>
              <p className="text-sm text-muted-foreground">
                아이데이션·콘텐츠 생성의 기반이 되는 B2B·B2G 판매 상품 정보를 관리합니다.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href={`${SALES_CONTENT_PRODUCTS_PATH}/new`}>상품 추가</Link>
            </Button>
          </div>
          <ProductList products={products} />
        </div>
      )}

      {/* 타겟 페르소나 */}
      {section === 'personas' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">타겟 페르소나</h2>
              <p className="text-sm text-muted-foreground">
                B2B·B2G 의사결정자의 프로파일을 구조화해 AI 아이데이션의 품질을 높입니다.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href={`${SALES_CONTENT_PERSONAS_PATH}/new`}>페르소나 추가</Link>
            </Button>
          </div>
          <PersonaList personas={personas} />
        </div>
      )}

      {/* 브랜드 프로필 */}
      {section === 'brand-profile' && (
        <div className="mx-auto max-w-3xl space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">브랜드 프로필</h2>
            <p className="text-sm text-muted-foreground">
              Space당 1개. 콘텐츠 톤·금칙어·비주얼 가이드의 단일 소스입니다.
            </p>
          </div>
          <BrandProfileForm initial={brandProfileInitial} />
        </div>
      )}
    </div>
  )
}

// ─── 채널 탭 ─────────────────────────────────────────────────────────────────

function ChannelsTab({ channels }: { channels: Channel[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">채널 계정</h2>
        <p className="text-sm text-muted-foreground">
          콘텐츠가 게시될 블로그·소셜 계정 설정. utm_source 는 platformSlug 로 부착됩니다.
        </p>
      </div>

      {channels.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            아직 등록된 배포 채널이 없습니다. 아래 폼으로 첫 채널을 추가하세요.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {channels.map((c) => (
            <Link
              key={c.id}
              href={`${SALES_CONTENT_CHANNELS_PATH}/${c.id}`}
              className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{c.name}</h3>
                    {!c.isActive && (
                      <Badge variant="outline" className="text-xs">
                        비활성
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {PLATFORM_LABEL[c.platform] ?? c.platform} · {c.kind} ·{' '}
                    <span className="font-mono">{c.platformSlug}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    배포 {c.publisherMode} · 수집 {c.collectorMode}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">채널 추가</h3>
        <ChannelForm mode="create" />
      </div>
    </div>
  )
}

// ─── 개선 규칙 탭 ─────────────────────────────────────────────────────────────

function RulesTab({ rules }: { rules: Rule[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">개선 규칙</h2>
        <p className="text-sm text-muted-foreground">
          ACTIVE 규칙은 모든 아이데이션·섹션 생성 프롬프트에 자동 주입됩니다. AI 제안
          규칙(PROPOSED)은 승인 후 활성화하세요.
        </p>
      </div>

      <AiInsightButton />
      <RuleList rules={rules} />

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">규칙 추가</h3>
        <RuleForm />
      </div>
    </div>
  )
}

// ─── 메인 탭 컴포넌트 ─────────────────────────────────────────────────────────

export function SettingsTabsClient({
  products,
  personas,
  brandProfileInitial,
  channels,
  rules,
}: Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const VALID_TABS = ['sales-info', 'channels', 'rules'] as const
  const rawTab = searchParams.get('tab')
  const tab = VALID_TABS.includes(rawTab as (typeof VALID_TABS)[number])
    ? (rawTab as (typeof VALID_TABS)[number])
    : 'sales-info'

  const setTab = useCallback(
    (t: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('tab', t)
      // 탭 전환 시 section 초기화
      params.delete('section')
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
        <p className="text-sm text-muted-foreground">
          세일즈 정보, 채널 계정, 개선 규칙을 통합 관리합니다.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="sales-info">세일즈 정보</TabsTrigger>
          <TabsTrigger value="channels">채널 계정</TabsTrigger>
          <TabsTrigger value="rules">개선 규칙</TabsTrigger>
        </TabsList>

        <TabsContent value="sales-info">
          <SalesInfoTab
            products={products}
            personas={personas}
            brandProfileInitial={brandProfileInitial}
          />
        </TabsContent>

        <TabsContent value="channels">
          <ChannelsTab channels={channels} />
        </TabsContent>

        <TabsContent value="rules">
          <RulesTab rules={rules} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
