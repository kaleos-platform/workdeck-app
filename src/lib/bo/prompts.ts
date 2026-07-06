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

// ─── 초안 생성 프롬프트 ──────────────────────────────────────────────────────

export type BoDraftMaterialCtx = {
  id: string
  title: string
  angle: string
  outline: Array<{ section: string; description: string }>
  targetKeyword?: string | null
}

export interface BoDraftPromptOpts {
  ctaUrl?: string | null
}

export interface BoDraftPromptBuilt {
  system: string
  messages: TextMessage[]
  traceHash: string
}

/**
 * 소재 기반 한국어 장문 블로그 초안 생성 프롬프트.
 * 제품 사실+크롤 텍스트만 사용, 과장 금지, 마지막에 CTA 섹션 포함.
 */
export function buildBoDraftPrompt(
  product: BoProductCtx,
  material: BoDraftMaterialCtx,
  opts?: BoDraftPromptOpts
): BoDraftPromptBuilt {
  const sections: string[] = []

  sections.push(
    '당신은 B2B/B2C 상품 전문 블로그 콘텐츠 작성자다.',
    '아래 상품 정보와 소재를 바탕으로 한국어 장문 블로그 포스팅을 작성한다.'
  )

  sections.push(renderProduct(product))

  sections.push(
    '## 소재 정보',
    `- 제목: ${material.title}`,
    `- 관점: ${material.angle}`,
    ...(material.targetKeyword ? [`- 타겟 키워드: ${material.targetKeyword}`] : []),
    '',
    '아웃라인 (반드시 이 구조를 준수한다):',
    ...material.outline.map((s, i) => `  ${i + 1}. [${s.section}] ${s.description}`)
  )

  const ctaInstruction = opts?.ctaUrl
    ? `마지막 섹션에 CTA(행동 유도) 문단을 포함하고 반드시 이 링크를 삽입한다: ${opts.ctaUrl}`
    : '마지막 섹션에 CTA(행동 유도) 문단을 포함한다.'

  sections.push(
    '## 작성 규칙',
    '1. 총 분량: 2000~4000자 (한국어 기준). 아웃라인 섹션 구조를 그대로 따른다.',
    '2. 제품 사실과 크롤된 홈페이지 텍스트에서 근거를 인용한다. 과장·허위 내용 금지.',
    ...(material.targetKeyword
      ? [`3. 타겟 키워드 "${material.targetKeyword}"를 제목과 본문에 자연스럽게 삽입한다.`]
      : ['3. 검색 의도에 맞는 키워드를 자연스럽게 삽입한다.']),
    `4. ${ctaInstruction}`,
    '5. 마크다운 형식으로 출력한다. (## 섹션 제목, **굵게** 등)',
    '',
    '## 출력 형식',
    '마크다운 본문만 반환한다. 코드블록·추가 설명·메타 정보 없이 글 본문만 출력한다.'
  )

  const system = sections.join('\n\n')
  const messages: TextMessage[] = [
    { role: 'user', content: '위 상품과 소재 정보를 바탕으로 블로그 포스팅을 작성해 주세요.' },
  ]

  const traceHash = computeBoPromptTraceHash({
    type: 'draft',
    productId: product.id,
    materialId: material.id,
    ctaUrl: opts?.ctaUrl ?? null,
  })

  return { system, messages, traceHash }
}

// ─── 섹션 재생성 프롬프트 ─────────────────────────────────────────────────────

export interface BoSectionRegenPostCtx {
  title: string
  targetKeyword?: string | null
}

export interface BoSectionRegenPromptBuilt {
  system: string
  messages: TextMessage[]
}

/**
 * 블로그 포스트의 특정 섹션 하나를 재작성하는 프롬프트.
 * AI는 섹션 제목을 제외한 본문만 마크다운으로 반환한다.
 */
export function buildBoSectionRegenPrompt(
  product: BoProductCtx,
  post: BoSectionRegenPostCtx,
  sectionHeading: string,
  instruction?: string | null
): BoSectionRegenPromptBuilt {
  const lines: string[] = []

  lines.push('당신은 블로그 콘텐츠 편집자다. 주어진 섹션 하나의 본문만 다시 작성한다.')
  lines.push('')
  lines.push(`[포스트 제목] ${post.title}`)
  if (post.targetKeyword) lines.push(`[타겟 키워드] ${post.targetKeyword}`)
  lines.push('')
  lines.push(renderProduct(product))
  lines.push('')
  lines.push(`[재작성할 섹션] ${sectionHeading}`)
  if (instruction?.trim()) lines.push(`[추가 지시] ${instruction.trim()}`)
  lines.push('')
  lines.push('## 작성 규칙')
  lines.push('1. 제품 사실과 크롤 텍스트 근거만 사용한다. 과장 금지.')
  lines.push('2. 원래 섹션의 내용 범위를 유지하되, 품질을 개선한다.')
  lines.push('3. 섹션 제목(## 또는 ###)은 출력하지 않는다. 본문 내용만 마크다운으로 반환한다.')

  const system = lines.join('\n')
  const messages: TextMessage[] = [
    { role: 'user', content: '위 섹션의 본문을 다시 작성해 주세요.' },
  ]

  return { system, messages }
}

// ─── 섹션 렌더러 ─────────────────────────────────────────────────────────────

// ─── 채널 변형 생성 프롬프트 ─────────────────────────────────────────────────

export interface BoVariantPostCtx {
  title: string
  bodyMarkdown: string
}

export interface BoVariantFormatProfile {
  toneGuide: string
  structureGuide: string
  lengthRange: { min: number; max: number }
  headingStyle: string
  forbiddenExpressions: string[]
  ctaStyle: string
}

export interface BoVariantPromptBuilt {
  system: string
  messages: TextMessage[]
}

/**
 * 마스터 포스트를 채널 포맷에 맞게 변환하는 프롬프트.
 * AI는 { title, body } JSON을 반환한다. body는 마크다운 형식.
 */
export function buildBoVariantPrompt(
  post: BoVariantPostCtx,
  profile: BoVariantFormatProfile,
  platform: string
): BoVariantPromptBuilt {
  const systemLines: string[] = []

  systemLines.push(`당신은 블로그 채널 변형 편집자다.`)
  systemLines.push(`마스터 포스트를 ${platform} 채널 포맷에 맞게 재작성한다.`)
  systemLines.push('')
  systemLines.push('[채널 포맷 프로필]')
  systemLines.push(`- 말투: ${profile.toneGuide}`)
  systemLines.push(`- 구조: ${profile.structureGuide}`)
  systemLines.push(
    `- 목표 분량: ${profile.lengthRange.min}~${profile.lengthRange.max}자 (한국어 기준)`
  )
  systemLines.push(`- 소제목 스타일: ${profile.headingStyle}`)
  systemLines.push(`- CTA 스타일: ${profile.ctaStyle}`)
  if (profile.forbiddenExpressions.length > 0) {
    systemLines.push(`- 금지 표현: ${profile.forbiddenExpressions.join(', ')}`)
  }
  systemLines.push('')
  systemLines.push('[작성 규칙]')
  systemLines.push('1. 마스터 포스트의 핵심 정보와 사실은 유지하되 채널 포맷에 맞게 재작성한다.')
  systemLines.push('2. 제목도 채널 톤에 맞게 자연스럽게 조정할 수 있다.')
  systemLines.push('3. 반드시 순수 JSON만 반환한다. 마크다운·설명·코드블록 감싸기 금지.')
  systemLines.push('형식: {"title":"...","body":"...(마크다운 본문)..."}')

  const system = systemLines.join('\n')

  const userLines: string[] = []
  userLines.push('[마스터 포스트]')
  userLines.push(`제목: ${post.title}`)
  userLines.push('')
  userLines.push(post.bodyMarkdown)
  userLines.push('')
  userLines.push('위 포스트를 채널 포맷에 맞게 변환해 주세요.')

  const messages: TextMessage[] = [{ role: 'user', content: userLines.join('\n') }]

  return { system, messages }
}

// ─── 섹션 렌더러 ─────────────────────────────────────────────────────────────

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
