// 블로그 포스트 초안 생성 오케스트레이터.
// 소재(BoMaterial, APPROVED) → AI 생성 → 마크다운→TipTap doc → BoPost DRAFT 저장.

import { prisma } from '@/lib/prisma'
import { generateTextWithFallback } from '@/lib/ai/providers'
import {
  buildBoDraftPrompt,
  buildBoSectionRegenPrompt,
  type BoProductCtx,
  type BoDraftMaterialCtx,
  type BoSectionRegenPostCtx,
} from './prompts'
import {
  markdownToTipTapDoc,
  type TipTapDoc,
  type TipTapNode,
  type TipTapTextNode,
} from './markdown-to-doc'
import { createBoPostVersion } from './post-versions'
import type { Prisma } from '@/generated/prisma/client'

// ─── 입출력 타입 ──────────────────────────────────────────────────────────────

export interface RunBoDraftGenerationInput {
  materialId: string
  spaceId: string
  userId?: string | null
}

export interface RunBoDraftSuccess {
  ok: true
  postId: string
  providerName: string
}

export interface RunBoDraftFailure {
  ok: false
  code: 'MATERIAL_NOT_FOUND' | 'MATERIAL_NOT_APPROVED' | 'AI_FAILURE' | 'NOT_CONFIGURED'
  message: string
  postId?: string // 포스트가 생성됐으나 AI 실패 시 FAILED 상태 포스트 id
}

export type RunBoDraftResult = RunBoDraftSuccess | RunBoDraftFailure

export interface RegenerateBoPostInput {
  postId: string
  spaceId: string
  userId?: string | null
}

export interface RegenerateBoPostSuccess {
  ok: true
  providerName: string
}

export interface RegenerateBoPostFailure {
  ok: false
  code: 'POST_NOT_FOUND' | 'AI_FAILURE' | 'NOT_CONFIGURED'
  message: string
}

export type RegenerateBoPostResult = RegenerateBoPostSuccess | RegenerateBoPostFailure

export interface RegenerateSectionInput {
  postId: string
  spaceId: string
  userId?: string | null
  heading: string
  instruction?: string | null
}

export interface RegenerateSectionSuccess {
  ok: true
  providerName: string
}

export interface RegenerateSectionFailure {
  ok: false
  code: 'POST_NOT_FOUND' | 'SECTION_NOT_FOUND' | 'AI_FAILURE' | 'NOT_CONFIGURED'
  message: string
}

export type RegenerateSectionResult = RegenerateSectionSuccess | RegenerateSectionFailure

// ─── 오케스트레이터 ───────────────────────────────────────────────────────────

/**
 * 승인된 소재(APPROVED)를 기반으로 BoPost 초안을 AI로 생성한다.
 * 생성 중 상태(GENERATING)로 row를 먼저 만들고, 성공 시 DRAFT, 실패 시 FAILED로 전환.
 */
export async function runBoDraftGeneration(
  input: RunBoDraftGenerationInput
): Promise<RunBoDraftResult> {
  // 1. 소재 + 제품 조회 (spaceId 범위 내 IDOR 방어)
  const material = await prisma.boMaterial.findFirst({
    where: { id: input.materialId, spaceId: input.spaceId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          category: true,
          oneLinerPitch: true,
          homepageUrl: true,
          crawledText: true,
          targetCustomer: true,
          features: true,
          customFields: true,
          ctaUrl: true,
        },
      },
    },
  })

  if (!material) {
    return { ok: false, code: 'MATERIAL_NOT_FOUND', message: '소재를 찾을 수 없습니다' }
  }

  if (material.status !== 'APPROVED') {
    return {
      ok: false,
      code: 'MATERIAL_NOT_APPROVED',
      message: '승인(APPROVED)된 소재만 초안을 생성할 수 있습니다',
    }
  }

  // 2. ctaUrl 스냅샷 (제품에서)
  const ctaUrl = material.product.ctaUrl ?? null

  // 3. BoPost 생성 (GENERATING 상태)
  const post = await prisma.boPost.create({
    data: {
      spaceId: input.spaceId,
      userId: input.userId ?? null,
      materialId: material.id,
      title: material.title,
      doc: { type: 'doc', content: [] } satisfies object,
      status: 'GENERATING',
      targetKeyword: material.targetKeyword ?? null,
      ctaUrl,
    },
    select: { id: true },
  })

  // 4. 프롬프트 빌드
  const productCtx = toProductCtx(material.product)
  const materialCtx = toMaterialCtx(material)
  const built = buildBoDraftPrompt(productCtx, materialCtx, { ctaUrl })

  try {
    // 5. AI 생성
    const { result, providerName } = await generateTextWithFallback({
      system: built.system,
      messages: built.messages,
      maxTokens: 8192,
      temperature: 0.7,
    })

    // 6. 마크다운 → TipTap doc
    const doc = markdownToTipTapDoc(result.content)

    // 7. DRAFT 상태로 업데이트
    await prisma.boPost.update({
      where: { id: post.id },
      data: {
        status: 'DRAFT',
        doc: doc as unknown as Prisma.InputJsonValue,
        bodyMarkdown: result.content,
        generationTraceHash: built.traceHash,
        errorMessage: null,
      },
    })

    return { ok: true, postId: post.id, providerName }
  } catch (err) {
    // 8. 실패 시 FAILED 상태로 전환, 기존 내용은 유지
    const errorMessage = err instanceof Error ? err.message : String(err)
    await prisma.boPost.update({
      where: { id: post.id },
      data: {
        status: 'FAILED',
        errorMessage: errorMessage.slice(0, 1000),
      },
    })

    return {
      ok: false,
      code: isNotConfigured(errorMessage) ? 'NOT_CONFIGURED' : 'AI_FAILURE',
      message: '초안 생성에 실패했습니다',
      postId: post.id,
    }
  }
}

/**
 * 기존 BoPost를 전체 재생성한다.
 * 현재 상태를 버전 스냅샷으로 보존 후 AI 재생성.
 * 실패 시 기존 내용·상태를 유지 (FAILED로 전환하지 않음).
 */
export async function regenerateBoPost(
  input: RegenerateBoPostInput
): Promise<RegenerateBoPostResult> {
  // 1. 포스트 + 소재 + 제품 조회
  const post = await prisma.boPost.findFirst({
    where: { id: input.postId, spaceId: input.spaceId },
    include: {
      material: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              category: true,
              oneLinerPitch: true,
              homepageUrl: true,
              crawledText: true,
              targetCustomer: true,
              features: true,
              customFields: true,
              ctaUrl: true,
            },
          },
        },
      },
    },
  })

  if (!post) {
    return { ok: false, code: 'POST_NOT_FOUND', message: '포스트를 찾을 수 없습니다' }
  }

  // 2. 현재 버전 스냅샷
  await prisma.$transaction(async (tx) => {
    await createBoPostVersion(tx, post, '재생성 직전 자동 저장', input.userId ?? undefined)
  })

  // 3. 프롬프트 빌드
  const productCtx = toProductCtx(post.material.product)
  const materialCtx = toMaterialCtx(post.material)
  const built = buildBoDraftPrompt(productCtx, materialCtx, { ctaUrl: post.ctaUrl ?? null })

  try {
    // 4. AI 생성
    const { result, providerName } = await generateTextWithFallback({
      system: built.system,
      messages: built.messages,
      maxTokens: 8192,
      temperature: 0.7,
    })

    // 5. 마크다운 → TipTap doc
    const doc = markdownToTipTapDoc(result.content)

    // 6. PUBLISH_APPROVED → IN_REVIEW 자동 회귀 (콘텐츠 변경)
    const nextStatus = post.status === 'PUBLISH_APPROVED' ? 'IN_REVIEW' : post.status

    await prisma.boPost.update({
      where: { id: post.id },
      data: {
        doc: doc as unknown as Prisma.InputJsonValue,
        bodyMarkdown: result.content,
        generationTraceHash: built.traceHash,
        status: nextStatus,
        errorMessage: null,
      },
    })

    return { ok: true, providerName }
  } catch (err) {
    // 실패 시 기존 내용·상태 유지
    return {
      ok: false,
      code: isNotConfigured(err instanceof Error ? err.message : String(err))
        ? 'NOT_CONFIGURED'
        : 'AI_FAILURE',
      message: '재생성에 실패했습니다',
    }
  }
}

/**
 * 블로그 포스트의 특정 섹션 하나를 재생성한다.
 * 현재 상태를 버전 스냅샷으로 보존 후 해당 섹션 노드만 교체.
 * 실패 시 기존 내용·상태를 유지.
 */
export async function regenerateSection(
  input: RegenerateSectionInput
): Promise<RegenerateSectionResult> {
  // 1. 포스트 + 소재 + 제품 조회
  const post = await prisma.boPost.findFirst({
    where: { id: input.postId, spaceId: input.spaceId },
    include: {
      material: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              category: true,
              oneLinerPitch: true,
              homepageUrl: true,
              crawledText: true,
              targetCustomer: true,
              features: true,
              customFields: true,
              ctaUrl: true,
            },
          },
        },
      },
    },
  })

  if (!post) {
    return { ok: false, code: 'POST_NOT_FOUND', message: '포스트를 찾을 수 없습니다' }
  }

  // 2. 대상 섹션 경계 탐색
  const currentDoc = post.doc as unknown as TipTapDoc
  const boundary = findSectionBoundary(currentDoc, input.heading)

  if (boundary.startIdx === -1) {
    return {
      ok: false,
      code: 'SECTION_NOT_FOUND',
      message: `섹션을 찾을 수 없습니다: ${input.heading}`,
    }
  }

  // 3. 현재 버전 스냅샷
  await prisma.$transaction(async (tx) => {
    await createBoPostVersion(
      tx,
      { id: post.id, spaceId: post.spaceId, title: post.title, doc: post.doc },
      '섹션 재생성 직전 자동 저장',
      input.userId ?? undefined
    )
  })

  // 4. 섹션 재생성 프롬프트
  const productCtx = toProductCtx(post.material.product)
  const postCtx: BoSectionRegenPostCtx = {
    title: post.title,
    targetKeyword: post.targetKeyword ?? null,
  }
  const built = buildBoSectionRegenPrompt(productCtx, postCtx, input.heading, input.instruction)

  try {
    // 5. AI 생성
    const { result, providerName } = await generateTextWithFallback({
      system: built.system,
      messages: built.messages,
      maxTokens: 2048,
      temperature: 0.7,
    })

    // 6. 새 섹션 마크다운 → TipTap 노드
    const newSectionDoc = markdownToTipTapDoc(result.content)

    // 7. 기존 doc에서 해당 섹션 body 교체 (heading은 유지)
    const { startIdx, endIdx } = boundary
    const newContent = [
      ...currentDoc.content.slice(0, startIdx + 1), // heading 포함 이전 노드
      ...newSectionDoc.content, // 새 섹션 본문 (heading 제외)
      ...currentDoc.content.slice(endIdx), // 다음 섹션 이후
    ]
    const newDoc: TipTapDoc = { type: 'doc', content: newContent }

    // 8. PUBLISH_APPROVED → IN_REVIEW 자동 회귀 (콘텐츠 변경)
    const nextStatus = post.status === 'PUBLISH_APPROVED' ? 'IN_REVIEW' : post.status

    await prisma.boPost.update({
      where: { id: post.id },
      data: {
        doc: newDoc as unknown as Prisma.InputJsonValue,
        status: nextStatus,
        errorMessage: null,
      },
    })

    return { ok: true, providerName }
  } catch (err) {
    // 실패 시 기존 내용·상태 유지
    return {
      ok: false,
      code: isNotConfigured(err instanceof Error ? err.message : String(err))
        ? 'NOT_CONFIGURED'
        : 'AI_FAILURE',
      message: '섹션 재생성에 실패했습니다',
    }
  }
}

// ─── 내부 유틸 ────────────────────────────────────────────────────────────────

// 섹션 경계 탐색: heading 위치(startIdx)와 다음 동일/상위 레벨 heading 위치(endIdx).
// startIdx === -1 이면 헤딩을 찾지 못한 것.
function findSectionBoundary(
  doc: TipTapDoc,
  heading: string
): { startIdx: number; endIdx: number } {
  const content = doc.content as TipTapNode[]

  // 헤딩 노드의 텍스트 추출
  const getHeadingText = (node: TipTapNode): string => {
    if (node.type !== 'heading' || !node.content) return ''
    return (node.content as TipTapTextNode[]).map((c) => c.text ?? '').join('')
  }

  const startIdx = content.findIndex((n) => n.type === 'heading' && getHeadingText(n) === heading)
  if (startIdx === -1) return { startIdx: -1, endIdx: -1 }

  const headingLevel = (content[startIdx].attrs?.level as number) ?? 2

  // 다음 동일 또는 상위(숫자가 작거나 같은) 레벨 heading 위치를 섹션 끝으로 결정
  let endIdx = content.length
  for (let i = startIdx + 1; i < content.length; i++) {
    const node = content[i]
    if (node.type === 'heading' && ((node.attrs?.level as number) ?? 6) <= headingLevel) {
      endIdx = i
      break
    }
  }

  return { startIdx, endIdx }
}

// Prisma include 결과에서 BoProductCtx 변환
function toProductCtx(p: {
  id: string
  name: string
  category?: string | null
  oneLinerPitch?: string | null
  homepageUrl?: string | null
  crawledText?: string | null
  targetCustomer?: string | null
  features: unknown
  customFields: unknown
}): BoProductCtx {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    oneLinerPitch: p.oneLinerPitch,
    homepageUrl: p.homepageUrl,
    crawledText: p.crawledText,
    targetCustomer: p.targetCustomer,
    features: Array.isArray(p.features)
      ? (p.features as Array<{ name: string; description: string }>)
      : null,
    customFields: Array.isArray(p.customFields)
      ? (p.customFields as Array<{ key: string; value: string }>)
      : null,
  }
}

// Prisma include 결과에서 BoDraftMaterialCtx 변환
function toMaterialCtx(m: {
  id: string
  title: string
  angle: string
  outline: unknown
  targetKeyword?: string | null
}): BoDraftMaterialCtx {
  return {
    id: m.id,
    title: m.title,
    angle: m.angle,
    outline: Array.isArray(m.outline)
      ? (m.outline as Array<{ section: string; description: string }>)
      : [],
    targetKeyword: m.targetKeyword,
  }
}

// AI 공급자 미구성 오류 판별
function isNotConfigured(message: string): boolean {
  return /not configured|구성되지 않|사용 가능한.*공급자가 구성되지/i.test(message)
}
