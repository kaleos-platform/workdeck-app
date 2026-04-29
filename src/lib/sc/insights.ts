// Phase 2 Unit 14 — AI Insight Generator
// 배포 성과 데이터를 집계해 → LLM 에 전달 → ImprovementRule(PROPOSED, source=AI) 생성.
// 셀프-임프루빙 루프의 마지막 고리를 닫는다 (성과 → 개선 규칙 → 다음 아이데이션).

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { generateTextWithFallback, type TextMessage } from '@/lib/ai/providers'
import { computePromptTraceHash } from './prompts'

// ─── 집계 ────────────────────────────────────────────────────────────────────

export type InsightBucketKey = {
  channelPlatform: string
  templateKind: string | null
  productId: string | null
}

export type InsightBucket = {
  key: InsightBucketKey
  deploymentIds: string[]
  sampleCount: number
  impressions: number
  views: number
  likes: number
  comments: number
  shares: number
  externalClicks: number
  internalClicks: number
  days: number // 집계 대상 배포가 걸친 고유 날짜 수
}

type AggregateInput = {
  spaceId: string
  sinceDays: number // 최근 N일
  minSamples?: number // 버킷당 최소 샘플 수 (기본 1)
}

export async function aggregateDeploymentPerformance(
  input: AggregateInput
): Promise<InsightBucket[]> {
  const since = new Date(Date.now() - input.sinceDays * 24 * 60 * 60 * 1000)
  const minSamples = input.minSamples ?? 1

  // PUBLISHED 배포의 metrics + 콘텐츠(productId/templateId) + 채널 플랫폼을 로드
  const deployments = await prisma.contentDeployment.findMany({
    where: {
      spaceId: input.spaceId,
      status: 'PUBLISHED',
      publishedAt: { gte: since },
    },
    select: {
      id: true,
      publishedAt: true,
      channel: { select: { platform: true } },
      content: {
        select: {
          productId: true,
          templateId: true,
        },
      },
      metrics: {
        select: {
          date: true,
          impressions: true,
          views: true,
          likes: true,
          comments: true,
          shares: true,
          externalClicks: true,
        },
      },
      _count: {
        select: { clickEvents: true },
      },
    },
  })

  // templateId → kind 매핑을 한 번에 로드
  const templateIds = Array.from(
    new Set(deployments.map((d) => d.content.templateId).filter((v): v is string => !!v))
  )
  const templateKindById = new Map<string, string>()
  if (templateIds.length > 0) {
    const templates = await prisma.template.findMany({
      where: { id: { in: templateIds } },
      select: { id: true, kind: true },
    })
    for (const t of templates) templateKindById.set(t.id, t.kind)
  }

  const bucketMap = new Map<string, InsightBucket>()

  for (const dep of deployments) {
    const key: InsightBucketKey = {
      channelPlatform: dep.channel.platform,
      templateKind: dep.content.templateId
        ? (templateKindById.get(dep.content.templateId) ?? null)
        : null,
      productId: dep.content.productId ?? null,
    }
    const keyStr = JSON.stringify([key.channelPlatform, key.templateKind, key.productId])
    const existing = bucketMap.get(keyStr) ?? {
      key,
      deploymentIds: [],
      sampleCount: 0,
      impressions: 0,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      externalClicks: 0,
      internalClicks: 0,
      days: 0,
    }

    existing.deploymentIds.push(dep.id)
    existing.sampleCount += 1
    existing.internalClicks += dep._count.clickEvents

    const dates = new Set<string>()
    for (const m of dep.metrics) {
      existing.impressions += m.impressions ?? 0
      existing.views += m.views ?? 0
      existing.likes += m.likes ?? 0
      existing.comments += m.comments ?? 0
      existing.shares += m.shares ?? 0
      existing.externalClicks += m.externalClicks ?? 0
      dates.add(m.date.toISOString().slice(0, 10))
    }
    existing.days += dates.size

    bucketMap.set(keyStr, existing)
  }

  return Array.from(bucketMap.values())
    .filter((b) => b.sampleCount >= minSamples)
    .sort((a, b) => b.impressions - a.impressions)
}

// ─── 프롬프트 ────────────────────────────────────────────────────────────────

export type InsightBuilderInput = {
  buckets: InsightBucket[]
  activeRules: Array<{ id: string; scope: string; title: string; body: string; weight: number }>
  maxProposals: number // 3~8 권장
}

export type InsightPromptBuilt = {
  system: string
  messages: TextMessage[]
  traceHash: string
}

const INSIGHT_JSON_SCHEMA = `
## 중요: 응답 형식
반드시 순수 JSON 만 반환한다. 마크다운/설명/코드블록 금지.
형식:
{
  "proposals": [
    {
      "scope": "WORKSPACE" | "PRODUCT" | "PERSONA" | "CHANNEL" | "COMBINATION",
      "title": "규칙 제목 (60자 이내, 명령형)",
      "body": "규칙 본문 (300자 이내, '...하라' 형태. 왜 그런지 근거를 포함)",
      "weight": 1~10 정수 (확신도),
      "targetChannelPlatform": "THREADS" | "NAVER_BLOG" | "X_TWITTER" | "LINKEDIN" | "META" | null,
      "targetProductId": string | null,
      "evidenceDeploymentIds": ["deployment id 배열 — 이 규칙의 근거가 된 배포"]
    }
  ]
}
`.trim()

export function buildInsightPrompt(input: InsightBuilderInput): InsightPromptBuilt {
  const sections: string[] = []
  sections.push('당신은 B2B/B2G 콘텐츠 마케팅 성과 분석가다.')
  sections.push(
    `다음 최근 배포 성과 데이터와 현재 활성 규칙을 바탕으로, 다음 콘텐츠를 개선할 규칙 후보 ${input.maxProposals}개 이하를 제안한다.`
  )
  sections.push(
    '- 기존 ACTIVE 규칙과 중복되는 제안은 금지. 수치적 근거(CTR/참여율 비교 등)가 빈약하면 제안 자체를 생략.'
  )
  sections.push(
    '- evidenceDeploymentIds 에는 이 제안이 참조한 실제 배포 ID 배열을 담는다. 없으면 빈 배열 금지 → 제안 자체 제거.'
  )
  sections.push(
    '- scope 선택 가이드: 특정 상품에만 유효하면 PRODUCT, 특정 채널에만 유효하면 CHANNEL, 둘 다면 COMBINATION, 전 워크스페이스 공통이면 WORKSPACE.'
  )

  sections.push(renderBucketTable(input.buckets))
  sections.push(renderActiveRules(input.activeRules))
  sections.push(INSIGHT_JSON_SCHEMA)

  const system = sections.join('\n\n')
  const messages: TextMessage[] = [
    {
      role: 'user',
      content: '위 데이터를 근거로 개선 규칙 후보를 제안해 주세요.',
    },
  ]

  const traceHash = computePromptTraceHash({
    buckets: input.buckets.map((b) => ({
      key: b.key,
      sampleCount: b.sampleCount,
      impressions: b.impressions,
      engagement: b.likes + b.comments + b.shares,
    })),
    ruleIds: input.activeRules.map((r) => r.id).sort(),
    maxProposals: input.maxProposals,
  })

  return { system, messages, traceHash }
}

function renderBucketTable(buckets: InsightBucket[]): string {
  if (buckets.length === 0) {
    return '[배포 성과] (최근 기간 내 유효 데이터 없음)'
  }
  const lines = ['[배포 성과 요약 — 채널 × 템플릿 × 상품 버킷]']
  for (const b of buckets) {
    const engagement = b.likes + b.comments + b.shares
    const ctrNum = b.impressions > 0 ? ((b.externalClicks / b.impressions) * 100).toFixed(2) : null
    const erNum = b.impressions > 0 ? ((engagement / b.impressions) * 100).toFixed(2) : null
    lines.push(
      `- 채널=${b.key.channelPlatform}, 템플릿=${b.key.templateKind ?? '없음'}, 상품=${b.key.productId ?? '전체'} | 배포 ${b.sampleCount}건 (id: ${b.deploymentIds.join(',')}) | 노출 ${b.impressions}, 조회 ${b.views}, 참여 ${engagement}(좋아요${b.likes}/댓글${b.comments}/공유${b.shares}), 외부클릭 ${b.externalClicks}, 내부클릭(UTM) ${b.internalClicks}${ctrNum ? `, CTR ${ctrNum}%` : ''}${erNum ? `, 참여율 ${erNum}%` : ''}`
    )
  }
  return lines.join('\n')
}

function renderActiveRules(rules: InsightBuilderInput['activeRules']): string {
  if (rules.length === 0) return '[현재 ACTIVE 규칙] 없음'
  const lines = ['[현재 ACTIVE 규칙 — 중복 제안 금지]']
  for (const r of rules) {
    lines.push(`- (${r.scope}, weight=${r.weight}) ${r.title}: ${r.body.slice(0, 100)}`)
  }
  return lines.join('\n')
}

// ─── 파서 ────────────────────────────────────────────────────────────────────

const ProposalSchema = z.object({
  scope: z.enum(['WORKSPACE', 'PRODUCT', 'PERSONA', 'CHANNEL', 'COMBINATION']),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  weight: z.number().int().min(1).max(10),
  targetChannelPlatform: z.string().nullable().optional(),
  targetProductId: z.string().nullable().optional(),
  evidenceDeploymentIds: z.array(z.string().min(1)).min(1),
})

export type InsightProposal = z.infer<typeof ProposalSchema>

const ResponseSchema = z.object({
  proposals: z.array(ProposalSchema),
})

export function parseInsightResponse(raw: string): InsightProposal[] {
  const trimmed = raw
    .trim()
    .replace(/^```(json)?\s*/i, '')
    .replace(/```\s*$/i, '')
  const parsed = JSON.parse(trimmed)
  return ResponseSchema.parse(parsed).proposals
}

// ─── 오케스트레이터 ─────────────────────────────────────────────────────────

export type RunInsightInput = {
  spaceId: string
  sinceDays?: number
  maxProposals?: number
}

export type RunInsightResult = {
  createdRules: number
  skippedReason?: 'NO_DATA' | 'NO_PROPOSALS'
  traceHash: string
  providerName?: string
  bucketCount: number
}

export async function runInsightGeneration(input: RunInsightInput): Promise<RunInsightResult> {
  const sinceDays = input.sinceDays ?? 30
  const maxProposals = Math.min(Math.max(input.maxProposals ?? 5, 1), 8)

  const buckets = await aggregateDeploymentPerformance({
    spaceId: input.spaceId,
    sinceDays,
    minSamples: 1,
  })

  const activeRules = await prisma.improvementRule.findMany({
    where: { spaceId: input.spaceId, status: 'ACTIVE' },
    select: { id: true, scope: true, title: true, body: true, weight: true },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  })

  if (buckets.length === 0) {
    return {
      createdRules: 0,
      skippedReason: 'NO_DATA',
      traceHash: computePromptTraceHash({ spaceId: input.spaceId, sinceDays }),
      bucketCount: 0,
    }
  }

  const prompt = buildInsightPrompt({ buckets, activeRules, maxProposals })

  const { result, providerName } = await generateTextWithFallback({
    system: prompt.system,
    messages: prompt.messages,
    responseFormat: 'json',
    maxTokens: 1800,
  })

  let proposals: InsightProposal[] = []
  try {
    proposals = parseInsightResponse(result.content)
  } catch {
    // 파싱 실패는 조용히 0건으로 기록 (재시도는 다음 스윕에서)
    return {
      createdRules: 0,
      skippedReason: 'NO_PROPOSALS',
      traceHash: prompt.traceHash,
      providerName,
      bucketCount: buckets.length,
    }
  }

  if (proposals.length === 0) {
    return {
      createdRules: 0,
      skippedReason: 'NO_PROPOSALS',
      traceHash: prompt.traceHash,
      providerName,
      bucketCount: buckets.length,
    }
  }

  // Prisma bulk create — 각 proposal 을 ImprovementRule(source=AI, status=PROPOSED) 로 저장
  const rows: Prisma.ImprovementRuleCreateManyInput[] = proposals.map((p) => ({
    spaceId: input.spaceId,
    scope: p.scope,
    source: 'AI',
    status: 'PROPOSED',
    title: p.title,
    body: p.body,
    weight: p.weight,
    targetProductId: p.targetProductId ?? null,
    // Platform → channelId 매핑은 단순 스킵 (platform 값만 참조용으로 body 에 남음).
    // 사용자가 승인하면서 targetChannelId 를 지정하게 한다.
    targetChannelId: null,
    evidenceDeploymentIds: p.evidenceDeploymentIds as Prisma.InputJsonValue,
  }))

  await prisma.improvementRule.createMany({ data: rows })

  return {
    createdRules: rows.length,
    traceHash: prompt.traceHash,
    providerName,
    bucketCount: buckets.length,
  }
}
