import { ImageResponse } from 'next/og'
import { DECK_META } from '@/lib/deck-meta'
import { DECK_LANDINGS } from '@/lib/marketing/decks'
import { MARKETING_DECK_SLUGS, type MarketingDeckSlugString } from '@/lib/marketing/routes'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * deck-meta.ts의 gradient는 tailwind 클래스 문자열이라 ImageResponse(edge, CSS 인라인)에서
 * 그대로 쓸 수 없다 — 같은 색감의 hex 2색 그라데이션을 여기서 별도로 정의한다.
 */
const DECK_OG_GRADIENTS: Record<MarketingDeckSlugString, [string, string]> = {
  'coupang-ads': ['#f97316', '#dc2626'],
  'seller-hub': ['#8b5cf6', '#7e22ce'],
  'sales-content': ['#d946ef', '#4f46e5'],
  finance: ['#10b981', '#0d9488'],
  recruiting: ['#0ea5e9', '#1d4ed8'],
  'blog-ops': ['#0ea5e9', '#0891b2'],
}

interface Props {
  params: Promise<{ deck: string }>
}

function isDeckSlug(value: string): value is MarketingDeckSlugString {
  return (MARKETING_DECK_SLUGS as readonly string[]).includes(value)
}

export function generateStaticParams() {
  return MARKETING_DECK_SLUGS.map((deck) => ({ deck }))
}

export default async function Image({ params }: Props) {
  const { deck } = await params
  const slug = isDeckSlug(deck) ? deck : MARKETING_DECK_SLUGS[0]
  const meta = DECK_META[slug]
  const content = DECK_LANDINGS[slug]
  const [from, to] = DECK_OG_GRADIENTS[slug]

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 100px',
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 32,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.8)',
          letterSpacing: 1,
        }}
      >
        Workdeck
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 20,
          fontSize: 72,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: -2,
        }}
      >
        {meta.name}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 28,
          fontSize: 32,
          color: 'rgba(255,255,255,0.92)',
          maxWidth: 900,
        }}
      >
        {content.hero.headline}
        {content.hero.highlight ? ` ${content.hero.highlight}` : ''}
      </div>
    </div>,
    { ...size }
  )
}
