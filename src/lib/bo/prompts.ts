import crypto from 'node:crypto'
import type { TextMessage } from '@/lib/ai/providers'

// ─── 공개 타입 ──────────────────────────────────────────────────────────────

export type BoProductCtx = {
  id: string
  name: string
  category?: string | null // B2B / B2C
  oneLinerPitch?: string | null
  homepageUrl?: string | null
  crawledText?: string | null // AI 분석용 — 최대 8k chars로 잘라서 사용
  targetCustomer?: string | null
  features?: Array<{ name: string; description: string }> | null
  customFields?: Array<{ key: string; value: string }> | null
}

export interface BoIdeationPromptBuilt {
  system: string
  messages: TextMessage[]
  traceHash: string
}

// ─── JSON 응답 형식 지시 ─────────────────────────────────────────────────────

const JSON_SCHEMA_INSTRUCTION = `
## 중요: 응답 형식
반드시 순수 JSON만 반환한다. 마크다운·설명·코드블록 금지.
형식:
{
  "appealPoints": [
    {
      "point": "소구점 한 줄 정의 (60자 이내)",
      "evidence": "근거·데이터·사례 (100자 이내)",
      "targetPain": "타겟 고객의 페인 포인트 (80자 이내)",
      "priority": 1
    }
  ],
  "materials": [
    {
      "title": "블로그 포스팅 제목 (60자 이내)",
      "appealPoint": "이 소재가 다루는 소구점 (한 줄 문자열)",
      "angle": "콘텐츠 접근 관점·프레임 (한 문장)",
      "outline": [
        { "section": "섹션 제목", "description": "해당 섹션에서 다룰 내용" }
      ],
      "targetKeyword": "대표 검색 키워드 (선택)"
    }
  ]
}
`.trim()

// ─── 프롬프트 빌더 ───────────────────────────────────────────────────────────

export function buildBoIdeationPrompt(
  product: BoProductCtx,
  userPromptInput?: string | null
): BoIdeationPromptBuilt {
  const sections: string[] = []

  sections.push(
    '당신은 B2B/B2C 상품 전문 블로그 콘텐츠 전략가다.',
    '아래 상품 정보를 분석하여 블로그 마케팅에 활용할 수 있는 소구점과 소재 후보를 발굴한다.'
  )

  sections.push(renderProduct(product))

  sections.push(
    '## 작업 지시',
    '1. 소구점(appealPoints) 5~8개를 도출한다. 각 소구점은 상품의 구체적인 강점·차별점을 기반으로 한다.',
    '2. 소재(materials) 6~10개를 제안한다. 각 소재는 하나의 소구점을 특정 각도로 풀어낸 블로그 포스팅 골격이다.',
    '3. priority 1이 가장 중요한 소구점이다.',
    '4. outline은 섹션명과 해당 섹션에서 다룰 내용을 포함한다 (2~5개 섹션).',
    '5. 타겟 고객의 실제 고민·검색 의도를 반영해 제목과 각도를 설정한다.'
  )

  sections.push(JSON_SCHEMA_INSTRUCTION)

  const system = sections.join('\n\n')

  const userParts: string[] = []
  if (userPromptInput?.trim()) {
    userParts.push('[추가 지시]', userPromptInput.trim())
  } else {
    userParts.push('위 상품 정보를 바탕으로 소구점과 블로그 소재 후보를 발굴해 주세요.')
  }

  const messages: TextMessage[] = [{ role: 'user', content: userParts.join('\n') }]

  const traceHash = computeBoPromptTraceHash({
    productId: product.id,
    productName: product.name,
    userPromptInput: userPromptInput ?? '',
  })

  return { system, messages, traceHash }
}

// SHA-256 재현성 추적 해시 — sc/prompts.ts 동일 패턴
export function computeBoPromptTraceHash(seed: unknown): string {
  const canonical = JSON.stringify(seed, canonicalReplacer)
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

function canonicalReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const sortedKeys = Object.keys(obj).sort()
    const out: Record<string, unknown> = {}
    for (const k of sortedKeys) out[k] = obj[k]
    return out
  }
  return value
}

// ─── 섹션 렌더러 ─────────────────────────────────────────────────────────────

const CRAWLED_TEXT_MAX_CHARS = 8000

function renderProduct(p: BoProductCtx): string {
  const lines = ['[상품 정보]', `- 상품명: ${p.name}`]
  if (p.category) lines.push(`- 카테고리: ${p.category}`)
  if (p.oneLinerPitch) lines.push(`- 한 줄 소개: ${p.oneLinerPitch}`)
  if (p.targetCustomer) lines.push(`- 타겟 고객: ${p.targetCustomer}`)
  if (p.homepageUrl) lines.push(`- 홈페이지: ${p.homepageUrl}`)

  if (p.features?.length) {
    lines.push('- 주요 기능:')
    for (const f of p.features) {
      lines.push(`  · ${f.name}: ${f.description}`)
    }
  }

  if (p.customFields?.length) {
    for (const f of p.customFields) {
      lines.push(`- ${f.key}: ${f.value}`)
    }
  }

  if (p.crawledText?.trim()) {
    const excerpt = p.crawledText.trim().slice(0, CRAWLED_TEXT_MAX_CHARS)
    lines.push('', '[홈페이지 크롤 텍스트 (참고용)]', excerpt)
    if (p.crawledText.trim().length > CRAWLED_TEXT_MAX_CHARS) {
      lines.push('... (이하 생략)')
    }
  }

  return lines.join('\n')
}
