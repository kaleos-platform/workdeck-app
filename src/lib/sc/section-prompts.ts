// 섹션별 AI 본문 주입 프롬프트 빌더. Unit 4 prompts 와 분리 — content 생성 맥락용.

import type { TextMessage } from '@/lib/ai/providers'

export interface SectionFillContext {
  productName?: string | null
  personaName?: string | null
  ideaTitle?: string | null
  ideaAngle?: string | null
  ideaKeyPoints?: string[] | null
  brandTone?: string[] | null
  brandForbidden?: string[] | null
}

export interface SectionFillInput {
  sectionLabel: string
  sectionKind: 'text' | 'imageSlot' | 'cta'
  sectionGuidance?: string | null
  constraints?: { maxLength?: number; required?: boolean }
  context: SectionFillContext
  additionalInstruction?: string | null
}

export function buildSectionFillPrompt(input: SectionFillInput): {
  system: string
  messages: TextMessage[]
} {
  const lines: string[] = []
  lines.push('당신은 B2B 콘텐츠 작성자다. 주어진 맥락을 근거로 섹션 1개의 본문만 작성한다.')
  lines.push('추가 설명·마크다운·코드블록 없이 본문 텍스트만 반환한다.')

  if (input.context.productName) lines.push(`- 상품: ${input.context.productName}`)
  if (input.context.personaName) lines.push(`- 페르소나: ${input.context.personaName}`)
  if (input.context.ideaTitle) lines.push(`- 글감 제목: ${input.context.ideaTitle}`)
  if (input.context.ideaAngle) lines.push(`- 글감 관점: ${input.context.ideaAngle}`)
  if (input.context.ideaKeyPoints?.length)
    lines.push(`- 핵심 메시지: ${input.context.ideaKeyPoints.join(' / ')}`)
  if (input.context.brandTone?.length) lines.push(`- 톤: ${input.context.brandTone.join(', ')}`)
  if (input.context.brandForbidden?.length)
    lines.push(`- 절대 쓰지 말 것: ${input.context.brandForbidden.join(', ')}`)

  lines.push('')
  lines.push(`[작성할 섹션] ${input.sectionLabel}`)
  if (input.sectionGuidance) lines.push(`가이드: ${input.sectionGuidance}`)
  if (input.constraints?.maxLength) lines.push(`최대 ${input.constraints.maxLength}자 이내로.`)

  const system = lines.join('\n')

  const userLines: string[] = []
  if (input.additionalInstruction) userLines.push(input.additionalInstruction)
  else userLines.push('위 맥락에 부합하는 본문을 작성해 주세요.')

  return {
    system,
    messages: [{ role: 'user', content: userLines.join('\n') }],
  }
}
