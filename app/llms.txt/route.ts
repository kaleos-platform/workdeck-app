import { buildMarketingUrl } from '@/lib/domain'
import { DECK_META } from '@/lib/deck-meta'
import { DECK_LANDINGS } from '@/lib/marketing/decks'
import { MARKETING_DECK_SLUGS } from '@/lib/marketing/routes'
import { DECK_PRICING_ROWS } from '@/lib/marketing/pricing-data'
import { getAllPosts } from '@/lib/marketing/blog'

export const dynamic = 'force-static'

function buildLlmsTxt(): string {
  const lines: string[] = []

  lines.push('# Workdeck')
  lines.push('')
  lines.push(
    '> Workdeck은 광고 분석, 재고·배송 운영, 재무 관리, 채용, 세일즈 콘텐츠, 블로그 운영 같은 ' +
      '비즈니스 업무를 필요한 것만 골라 쓰며 목표를 달성하는 워크스페이스입니다.'
  )
  lines.push('')
  lines.push(
    '현재 전 덱 베타 기간 동안 무료로 이용할 수 있으며, 필요한 덱만 골라 쓰고 언제든 추가할 수 있습니다.'
  )
  lines.push('')

  lines.push('## 덱')
  lines.push('')
  for (const slug of MARKETING_DECK_SLUGS) {
    const meta = DECK_META[slug]
    const content = DECK_LANDINGS[slug]
    lines.push(`### ${meta.name} (${slug})`)
    lines.push('')
    lines.push(`- URL: ${buildMarketingUrl(`/${slug}`)}`)
    lines.push(`- 설명: ${content.seo.description}`)
    if (content.features.length > 0) {
      lines.push('- 주요 기능:')
      for (const feature of content.features) {
        lines.push(`  - ${feature.title}: ${feature.description}`)
      }
    }
    lines.push('')
  }

  lines.push('## Pricing')
  lines.push('')
  lines.push('현재 전 덱 베타 무료. 아래는 정식 전환 시 예정가(월, VAT 포함)입니다.')
  lines.push('')
  for (const row of DECK_PRICING_ROWS) {
    lines.push(
      `- ${row.name}: 베타 무료 (예정가 월 ${row.totalPrice.toLocaleString('ko-KR')}원, VAT 포함)`
    )
  }
  lines.push('')
  lines.push(`- Pricing 페이지: ${buildMarketingUrl('/pricing')}`)
  lines.push('')

  const posts = getAllPosts()
  if (posts.length > 0) {
    lines.push('## Blog')
    lines.push('')
    for (const post of posts) {
      lines.push(`- ${post.title} (${post.date}): ${buildMarketingUrl(`/blog/${post.slug}`)}`)
    }
    lines.push('')
  }

  lines.push('## Links')
  lines.push('')
  lines.push(`- 홈: ${buildMarketingUrl('/')}`)
  lines.push(`- 블로그: ${buildMarketingUrl('/blog')}`)
  lines.push(`- 회사 소개: ${buildMarketingUrl('/about')}`)
  lines.push(`- 문의: ${buildMarketingUrl('/contact')}`)
  lines.push(`- 이용약관: ${buildMarketingUrl('/terms')}`)
  lines.push(`- 개인정보처리방침: ${buildMarketingUrl('/privacy')}`)
  lines.push(`- Sitemap: ${buildMarketingUrl('/sitemap.xml')}`)
  lines.push('')

  return lines.join('\n')
}

export async function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
