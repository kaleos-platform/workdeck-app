// AI 정규화 결과 검증. 사실·인용의 evidence 가 원문의 부분 문자열이 아니면 버린다(창작 방지, 결정적).

import { z } from 'zod'
import { blockIdAt, type TextSegment } from './notion-blocks'

export const normalizedSourceSchema = z.object({
  fields: z.object({
    eventDate: z.string().nullable().optional(),
    place: z.string().nullable().optional(),
    audience: z.string().nullable().optional(),
    org: z.string().nullable().optional(),
    products: z.array(z.string()).optional(),
  }),
  facts: z.array(z.object({ text: z.string().min(1), evidence: z.string() })).default([]),
  quotes: z
    .array(
      z.object({
        speaker: z.string().nullable().optional(),
        text: z.string().min(1),
        evidence: z.string(),
      })
    )
    .default([]),
})
export type NormalizedSource = z.infer<typeof normalizedSourceSchema>

export type Evidence = { text: string; offset: number; blockId: string | null }
export type VerifiedSource = {
  fields: NormalizedSource['fields']
  facts: { text: string; evidence: Evidence }[]
  quotes: { speaker: string | null; text: string; evidence: Evidence }[]
}

function locate(rawText: string, segments: TextSegment[], evidence: string): Evidence | null {
  const needle = evidence.trim()
  if (needle.length < 2) return null
  const offset = rawText.indexOf(needle)
  if (offset < 0) return null
  return { text: needle, offset, blockId: blockIdAt(segments, offset) }
}

export function verifyEvidence(
  input: NormalizedSource,
  rawText: string,
  segments: TextSegment[]
): { data: VerifiedSource; dropped: number } {
  let dropped = 0
  const facts: VerifiedSource['facts'] = []
  for (const f of input.facts) {
    const ev = locate(rawText, segments, f.evidence)
    if (ev) facts.push({ text: f.text, evidence: ev })
    else dropped++
  }
  const quotes: VerifiedSource['quotes'] = []
  for (const q of input.quotes) {
    const ev = locate(rawText, segments, q.evidence)
    if (ev) quotes.push({ speaker: q.speaker ?? null, text: q.text, evidence: ev })
    else dropped++
  }
  return { data: { fields: input.fields, facts, quotes }, dropped }
}
