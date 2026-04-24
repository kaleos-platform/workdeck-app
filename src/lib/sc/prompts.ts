import crypto from 'node:crypto'
import type { TextMessage } from '@/lib/ai/providers'

// ─── 공개 타입 ──────────────────────────────────────────────────────────────

// Unit 13 ImprovementRule 과 형태 맞춘 프록시 타입. 당장은 빈 배열로 전달된다.
export type IdeationRule = {
  id: string
  scope: 'workspace' | 'product' | 'persona' | 'channel' | 'combination'
  text: string
  weight: number
}

export type IdeationProductCtx = {
  id: string
  name: string
  oneLinerPitch?: string | null
  valueProposition?: string | null
  targetCustomers?: string | null
  keyFeatures?: string[] | null
  differentiators?: string[] | null
  painPointsAddressed?: string[] | null
}

export type IdeationPersonaCtx = {
  id: string
  name: string
  jobTitle?: string | null
  industry?: string | null
  companySize?: string | null
  seniority?: string | null
  decisionRole?: string | null
  goals?: string[] | null
  painPoints?: string[] | null
  objections?: string[] | null
  preferredChannels?: string[] | null
  toneHints?: string | null
}

export type IdeationBrandCtx = {
  companyName: string
  shortDescription?: string | null
  missionStatement?: string | null
  toneOfVoice?: string[] | null
  forbiddenPhrases?: string[] | null
  preferredPhrases?: string[] | null
}

export interface IdeationBuilderInput {
  product?: IdeationProductCtx | null
  persona?: IdeationPersonaCtx | null
  brand?: IdeationBrandCtx | null
  rules?: IdeationRule[]
  userPromptInput?: string | null
  count: number // 생성할 후보 수 (3~10)
}

export interface IdeationPromptBuilt {
  system: string
  messages: TextMessage[]
  traceHash: string
  ruleIds: string[]
}

// ─── 빌더 ───────────────────────────────────────────────────────────────────

const JSON_SCHEMA_INSTRUCTION = `
## 중요: 응답 형식
반드시 순수 JSON 만 반환한다. 마크다운/설명/코드블록 금지.
형식:
{
  "ideas": [
    {
      "title": "한 줄 글감 제목 (40자 이내)",
      "hook": "독자의 주의를 끄는 한 문장 (60자 이내)",
      "angle": "콘텐츠 관점 · 접근법 (한 문장)",
      "keyPoints": ["핵심 메시지 3~5개"],
      "targetChannel": "blog" | "social" | "cardnews",
      "reasoning": "이 글감이 적합한 이유 (2~3문장)"
    }
  ]
}
`.trim()

export function buildIdeationPrompt(input: IdeationBuilderInput): IdeationPromptBuilt {
  const rules = input.rules ?? []
  const count = Math.min(Math.max(input.count, 1), 10)

  const sections: string[] = []
  sections.push('당신은 B2B/B2G 콘텐츠 마케팅 전략가다.')
  sections.push(`다음 맥락을 바탕으로 서로 다른 관점의 글감 후보 ${count}개를 제안한다.`)

  if (input.product) sections.push(renderProduct(input.product))
  if (input.persona) sections.push(renderPersona(input.persona))
  if (input.brand) sections.push(renderBrand(input.brand))
  if (rules.length > 0) sections.push(renderRules(rules))

  sections.push(JSON_SCHEMA_INSTRUCTION)

  const system = sections.join('\n\n')

  const userParts: string[] = []
  if (input.userPromptInput && input.userPromptInput.trim().length > 0) {
    userParts.push('[사용자 지시]')
    userParts.push(input.userPromptInput.trim())
  } else {
    userParts.push('위 맥락에 가장 적합한 글감 후보를 제안해 주세요.')
  }
  const userContent = userParts.join('\n')

  const messages: TextMessage[] = [{ role: 'user', content: userContent }]

  const traceHash = computePromptTraceHash({
    product: input.product ?? null,
    persona: input.persona ?? null,
    brand: input.brand ?? null,
    ruleIds: rules.map((r) => r.id).sort(),
    userPromptInput: input.userPromptInput ?? '',
    count,
  })

  return { system, messages, traceHash, ruleIds: rules.map((r) => r.id) }
}

// 빌더 입력 핵심 만 담은 정규화된 JSON 의 SHA-256. 재현성 추적용.
// 공백/키 순서 차이는 JSON.stringify + key sort 로 흡수.
export function computePromptTraceHash(seed: unknown): string {
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

// ─── 섹션 렌더 ──────────────────────────────────────────────────────────────

function renderProduct(p: IdeationProductCtx): string {
  const lines = ['[상품]', `- 이름: ${p.name}`]
  if (p.oneLinerPitch) lines.push(`- 한 줄 소개: ${p.oneLinerPitch}`)
  if (p.valueProposition) lines.push(`- 가치제안: ${p.valueProposition}`)
  if (p.targetCustomers) lines.push(`- 타겟 고객: ${p.targetCustomers}`)
  if (p.keyFeatures?.length) lines.push(`- 핵심 기능: ${p.keyFeatures.join(', ')}`)
  if (p.differentiators?.length) lines.push(`- 차별화: ${p.differentiators.join(', ')}`)
  if (p.painPointsAddressed?.length)
    lines.push(`- 해결하는 고통: ${p.painPointsAddressed.join(', ')}`)
  return lines.join('\n')
}

function renderPersona(p: IdeationPersonaCtx): string {
  const lines = ['[페르소나]', `- 이름: ${p.name}`]
  if (p.jobTitle) lines.push(`- 직함: ${p.jobTitle}`)
  if (p.industry) lines.push(`- 산업: ${p.industry}`)
  if (p.companySize) lines.push(`- 조직 규모: ${p.companySize}`)
  if (p.seniority) lines.push(`- 시니어리티: ${p.seniority}`)
  if (p.decisionRole) lines.push(`- 의사결정 역할: ${p.decisionRole}`)
  if (p.goals?.length) lines.push(`- 목표: ${p.goals.join(', ')}`)
  if (p.painPoints?.length) lines.push(`- 고통/과제: ${p.painPoints.join(', ')}`)
  if (p.objections?.length) lines.push(`- 반대/이의: ${p.objections.join(', ')}`)
  if (p.preferredChannels?.length) lines.push(`- 선호 채널: ${p.preferredChannels.join(', ')}`)
  if (p.toneHints) lines.push(`- 선호 톤: ${p.toneHints}`)
  return lines.join('\n')
}

function renderBrand(b: IdeationBrandCtx): string {
  const lines = ['[브랜드 가이드]', `- 회사명: ${b.companyName}`]
  if (b.shortDescription) lines.push(`- 간단 설명: ${b.shortDescription}`)
  if (b.missionStatement) lines.push(`- 미션: ${b.missionStatement}`)
  if (b.toneOfVoice?.length) lines.push(`- 톤 오브 보이스: ${b.toneOfVoice.join(', ')}`)
  if (b.forbiddenPhrases?.length)
    lines.push(`- 금칙 표현(사용 금지): ${b.forbiddenPhrases.join(', ')}`)
  if (b.preferredPhrases?.length) lines.push(`- 선호 표현: ${b.preferredPhrases.join(', ')}`)
  return lines.join('\n')
}

function renderRules(rules: IdeationRule[]): string {
  const lines = ['[활성 개선 규칙 — 반드시 반영]']
  rules
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .forEach((r, i) => {
      lines.push(`${i + 1}. (${r.scope}) ${r.text}`)
    })
  return lines.join('\n')
}
