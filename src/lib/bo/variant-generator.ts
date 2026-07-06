// 채널 변형 생성 오케스트레이터.
// PUBLISH_APPROVED 포스트 × 채널 → AI 재작성 → BoPostVariant READY 저장.
// passthrough 채널(OWN_HOMEPAGE)은 LLM 없이 마스터 본문을 그대로 복사.

import { prisma } from '@/lib/prisma'
import { generateTextWithFallback } from '@/lib/ai/providers'
import { buildBoVariantPrompt } from './prompts'
import {
  markdownToTipTapDoc,
  type TipTapDoc,
  type TipTapNode,
  type TipTapTextNode,
} from './markdown-to-doc'
import { DEFAULT_PROFILES, type FormatProfile } from './channel-profiles'
import type { BoPlatform, Prisma } from '@/generated/prisma/client'

// ─── 입출력 타입 ──────────────────────────────────────────────────────────────

export interface GenerateBoVariantInput {
  postId: string
  channelId: string
  spaceId: string
}

export interface GenerateBoVariantSuccess {
  ok: true
  variantId: string
  providerName?: string
}

export interface GenerateBoVariantFailure {
  ok: false
  code:
    | 'POST_NOT_FOUND'
    | 'POST_NOT_APPROVED'
    | 'CHANNEL_NOT_FOUND'
    | 'AI_FAILURE'
    | 'NOT_CONFIGURED'
    | 'PARSE_FAILURE'
  message: string
  variantId?: string
}

export type GenerateBoVariantResult = GenerateBoVariantSuccess | GenerateBoVariantFailure

// ─── 오케스트레이터 ───────────────────────────────────────────────────────────

/**
 * 포스트 × 채널 변형을 생성한다.
 * - PUBLISH_APPROVED 상태 포스트만 허용 (그 외 타입 오류 반환)
 * - upsert로 변형 row를 GENERATING 상태로 먼저 확보 후 LLM 호출
 * - passthrough 채널은 LLM 없이 마스터 그대로 READY
 * - 실패 시 FAILED + errorMessage 기록
 */
export async function generateBoVariant(
  input: GenerateBoVariantInput
): Promise<GenerateBoVariantResult> {
  const { postId, channelId, spaceId } = input

  // 1. 포스트 조회 + PUBLISH_APPROVED 검증
  const post = await prisma.boPost.findFirst({
    where: { id: postId, spaceId },
    select: { id: true, status: true, title: true, doc: true, bodyMarkdown: true },
  })

  if (!post) {
    return { ok: false, code: 'POST_NOT_FOUND', message: '포스트를 찾을 수 없습니다' }
  }

  if (post.status !== 'PUBLISH_APPROVED') {
    return {
      ok: false,
      code: 'POST_NOT_APPROVED',
      message: '출판 승인(PUBLISH_APPROVED) 상태의 포스트만 변형을 생성할 수 있습니다',
    }
  }

  // 2. 채널 조회 (spaceId 범위 + isActive 체크)
  const channel = await prisma.boChannel.findFirst({
    where: { id: channelId, spaceId, isActive: true },
    select: { id: true, platform: true, name: true, formatProfile: true },
  })

  if (!channel) {
    return { ok: false, code: 'CHANNEL_NOT_FOUND', message: '채널을 찾을 수 없습니다' }
  }

  // 채널 저장 프로필을 플랫폼 기본 프로필과 병합
  const storedProfile = channel.formatProfile as Partial<FormatProfile>
  const defaultProfile = DEFAULT_PROFILES[channel.platform as BoPlatform]
  const profile: FormatProfile = { ...defaultProfile, ...storedProfile }

  // 3. 변형 row를 GENERATING 상태로 upsert (충돌 시 재생성)
  const variant = await prisma.boPostVariant.upsert({
    where: { postId_channelId: { postId, channelId } },
    create: {
      spaceId,
      postId,
      channelId,
      title: post.title,
      doc: post.doc as unknown as Prisma.InputJsonValue,
      status: 'GENERATING',
    },
    update: {
      status: 'GENERATING',
      errorMessage: null,
    },
    select: { id: true },
  })

  // 4. passthrough: LLM 없이 마스터 그대로 복사 → READY
  if (profile.passthrough) {
    await prisma.boPostVariant.update({
      where: { id: variant.id },
      data: {
        title: post.title,
        doc: post.doc as unknown as Prisma.InputJsonValue,
        status: 'READY',
        errorMessage: null,
      },
    })
    return { ok: true, variantId: variant.id }
  }

  // 5. 마스터 마크다운 준비 (bodyMarkdown이 없으면 doc에서 변환)
  const masterMarkdown = post.bodyMarkdown ?? docToMarkdown(post.doc as unknown as TipTapDoc)

  // 6. AI 변형 생성
  try {
    const built = buildBoVariantPrompt(
      { title: post.title, bodyMarkdown: masterMarkdown },
      profile,
      channel.platform
    )

    const { result, providerName } = await generateTextWithFallback({
      system: built.system,
      messages: built.messages,
      responseFormat: 'json',
      maxTokens: 8192,
      temperature: 0.7,
    })

    // JSON 파싱: { title, body }
    const parsed = parseVariantJson(result.content)
    if (!parsed) {
      await prisma.boPostVariant.update({
        where: { id: variant.id },
        data: { status: 'FAILED', errorMessage: 'AI 응답 JSON 파싱 실패' },
      })
      return {
        ok: false,
        code: 'PARSE_FAILURE',
        message: 'AI 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요',
        variantId: variant.id,
      }
    }

    const doc = markdownToTipTapDoc(parsed.body)

    await prisma.boPostVariant.update({
      where: { id: variant.id },
      data: {
        title: parsed.title || post.title,
        doc: doc as unknown as Prisma.InputJsonValue,
        status: 'READY',
        errorMessage: null,
      },
    })

    return { ok: true, variantId: variant.id, providerName }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await prisma.boPostVariant.update({
      where: { id: variant.id },
      data: { status: 'FAILED', errorMessage: errorMessage.slice(0, 1000) },
    })
    return {
      ok: false,
      code: isNotConfigured(errorMessage) ? 'NOT_CONFIGURED' : 'AI_FAILURE',
      message: '변형 생성에 실패했습니다',
      variantId: variant.id,
    }
  }
}

// ─── 내부 유틸 ────────────────────────────────────────────────────────────────

function isNotConfigured(msg: string): boolean {
  return /not configured|구성되지 않|사용 가능한.*공급자가 구성되지/i.test(msg)
}

function stripCodeFence(s: string): string {
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(s.trim())
  return m ? m[1].trim() : s
}

function parseVariantJson(raw: string): { title: string; body: string } | null {
  try {
    const cleaned = stripCodeFence(raw.trim())
    const obj = JSON.parse(cleaned) as Record<string, unknown>
    if (typeof obj?.title === 'string' && typeof obj?.body === 'string') {
      return { title: obj.title, body: obj.body }
    }
    return null
  } catch {
    return null
  }
}

// ─── 최소 doc→마크다운 변환기 (bodyMarkdown null 폴백용) ──────────────────────
// src/lib/bo/exporters 를 임포트하지 않고 로컬에서 처리.

function docToMarkdown(doc: TipTapDoc): string {
  return (doc.content ?? [])
    .map((node) => nodeToMarkdown(node))
    .filter(Boolean)
    .join('\n\n')
}

function nodeToMarkdown(node: TipTapNode): string {
  switch (node.type) {
    case 'heading': {
      const level = (node.attrs?.level as number) ?? 2
      const prefix = '#'.repeat(Math.min(Math.max(level, 1), 6))
      return `${prefix} ${inlineToMarkdown(node.content as TipTapTextNode[])}`
    }
    case 'paragraph':
      return inlineToMarkdown(node.content as TipTapTextNode[])
    case 'bulletList':
      return (node.content ?? [])
        .map((item) => {
          const paragraphs = ((item as TipTapNode).content ?? [])
            .map((p) => inlineToMarkdown((p as TipTapNode).content as TipTapTextNode[]))
            .join(' ')
          return `- ${paragraphs}`
        })
        .join('\n')
    case 'orderedList':
      return (node.content ?? [])
        .map((item, i) => {
          const paragraphs = ((item as TipTapNode).content ?? [])
            .map((p) => inlineToMarkdown((p as TipTapNode).content as TipTapTextNode[]))
            .join(' ')
          return `${i + 1}. ${paragraphs}`
        })
        .join('\n')
    case 'blockquote': {
      const inner = (node.content ?? []).map((p) => nodeToMarkdown(p as TipTapNode)).join('\n')
      return inner
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')
    }
    case 'codeBlock': {
      const text = ((node.content as TipTapTextNode[]) ?? []).map((n) => n.text ?? '').join('')
      const lang = (node.attrs?.language as string) ?? ''
      return `\`\`\`${lang}\n${text}\n\`\`\``
    }
    default:
      return ''
  }
}

function inlineToMarkdown(nodes: TipTapTextNode[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      let text = n.text ?? ''
      const marks = n.marks ?? []
      const hasBold = marks.some((m) => m.type === 'bold')
      const hasItalic = marks.some((m) => m.type === 'italic')
      const linkMark = marks.find((m) => m.type === 'link')
      if (linkMark?.attrs?.href) text = `[${text}](${String(linkMark.attrs.href)})`
      if (hasBold && hasItalic) return `***${text}***`
      if (hasBold) return `**${text}**`
      if (hasItalic) return `*${text}*`
      return text
    })
    .join('')
}
