// Aside 자동 게시 — 승인본을 게시 단위(배포)에 고정하고, 본문의 `[사진: …]` 자리를 사람이 채우게 한다.
// 워커는 publishSnapshot 만 게시한다(승인 뒤 콘텐츠를 고쳐도 게시본은 바뀌지 않는다).

import { z } from 'zod'
import { exportNaverPost } from '@/lib/sc/exporters/naver-post'

type DocNode = { type?: string; text?: string; content?: DocNode[] }

const PHOTO_RE = /^\s*\[사진:\s*(.+?)\]\s*$/

export const asideChannelConfigSchema = z.object({
  // false 면 네이버 임시저장에서 멈추고 사람이 확인·발행한다(리허설).
  autoPublish: z.boolean().default(false),
  blogId: z.string().trim().min(1).max(100).optional(),
  defaultCategory: z.string().trim().max(100).optional(),
  account: z.string().trim().max(20).optional(), // Aside 계정 id (예: u1)
})
export type AsideChannelConfig = z.infer<typeof asideChannelConfigSchema>

export function readAsideConfig(config: unknown): AsideChannelConfig {
  const raw = (config as { aside?: unknown } | null)?.aside
  const parsed = asideChannelConfigSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : { autoPublish: false }
}

export type SnapshotBlock =
  | { kind: 'html'; html: string }
  | { kind: 'photo'; index: number; label: string; assetId?: string | null }

export interface PublishSnapshot {
  version: 1
  title: string
  blocks: SnapshotBlock[]
  category: string | null
  tags: string[]
  autoPublish: boolean
}

export const assetPlanSchema = z.object({
  slots: z
    .array(
      z.object({
        index: z.number().int().min(0),
        assetId: z.string().min(1).nullable().optional(),
        skip: z.boolean().optional(),
      })
    )
    .max(100),
})
export type AssetPlan = z.infer<typeof assetPlanSchema>

function nodeText(node: DocNode): string {
  if (typeof node.text === 'string') return node.text
  return Array.isArray(node.content) ? node.content.map(nodeText).join('') : ''
}

/** 최상위 문단 중 `[사진: 설명]` 한 줄짜리를 순서대로 사진 자리로 본다. */
export function splitDocAtPhotos(doc: unknown): Array<DocNode[] | { index: number; label: string }> {
  const top = Array.isArray((doc as DocNode | null)?.content) ? (doc as DocNode).content! : []
  const parts: Array<DocNode[] | { index: number; label: string }> = []
  let run: DocNode[] = []
  let index = 0
  for (const node of top) {
    const m = node.type === 'paragraph' ? PHOTO_RE.exec(nodeText(node)) : null
    if (m) {
      if (run.length) parts.push(run)
      run = []
      parts.push({ index: index++, label: m[1].trim() })
    } else {
      run.push(node)
    }
  }
  if (run.length) parts.push(run)
  return parts
}

export function buildPublishSnapshot(input: {
  title: string
  doc: unknown
  deploymentUrl: string
  category?: string | null
  tags?: string[]
  autoPublish: boolean
}): PublishSnapshot {
  const blocks: SnapshotBlock[] = splitDocAtPhotos(input.doc).map((part) =>
    Array.isArray(part)
      ? {
          kind: 'html' as const,
          html: exportNaverPost({
            doc: { type: 'doc', content: part },
            deploymentUrl: input.deploymentUrl,
          }).html,
        }
      : { kind: 'photo' as const, index: part.index, label: part.label }
  )
  return {
    version: 1,
    title: input.title,
    blocks,
    category: input.category ?? null,
    tags: input.tags ?? [],
    autoPublish: input.autoPublish,
  }
}

export function photoSlots(snapshot: PublishSnapshot): Array<{ index: number; label: string }> {
  return snapshot.blocks.flatMap((b) => (b.kind === 'photo' ? [{ index: b.index, label: b.label }] : []))
}

/**
 * 사람이 고른 사진을 게시본에 넣는다. 모든 자리가 사진 또는 「빼기」여야 한다.
 * 뺀 자리는 블록째 지워 `[사진: …]` 문구가 게시되지 않게 한다.
 */
export function applyAssetPlan(
  snapshot: PublishSnapshot,
  plan: AssetPlan,
  allowedAssetIds: Set<string>
): { ok: true; snapshot: PublishSnapshot } | { ok: false; message: string } {
  const byIndex = new Map(plan.slots.map((s) => [s.index, s]))
  const blocks: SnapshotBlock[] = []
  for (const block of snapshot.blocks) {
    if (block.kind !== 'photo') {
      blocks.push(block)
      continue
    }
    const choice = byIndex.get(block.index)
    if (choice?.skip) continue
    if (!choice?.assetId) {
      return { ok: false, message: `사진 자리 ${block.index + 1}번(${block.label})이 비어 있습니다` }
    }
    if (!allowedAssetIds.has(choice.assetId)) {
      return { ok: false, message: `사진 자리 ${block.index + 1}번의 사진을 찾을 수 없습니다` }
    }
    blocks.push({ ...block, assetId: choice.assetId })
  }
  return { ok: true, snapshot: { ...snapshot, blocks } }
}
