// 콘텐츠 배포(ContentDeployment) 생성 — 배포 API 와 승인 큐 액션(sales-content.post.publish)이 함께 쓴다.

import { prisma } from '@/lib/prisma'
import type { DeploymentCreateInput } from './schemas'
import { deriveUtmDefaults, generateShortSlug, normalizeKebab } from './utm'

export class DeploymentSlugError extends Error {}

type DeploymentChannel = {
  id: string
  kind: Parameters<typeof deriveUtmDefaults>[0]['channelKind']
  platformSlug: string
}
type DeploymentInput = Omit<DeploymentCreateInput, 'contentId' | 'channelId'>

/** create data(shortSlug 포함). content·channel 은 호출자가 같은 Space 인지 확인한 뒤 넘긴다. */
export function deploymentData(
  spaceId: string,
  content: { id: string; title: string },
  channel: DeploymentChannel,
  input: DeploymentInput
) {
  const utmDefaults = deriveUtmDefaults({
    channelPlatformSlug: channel.platformSlug,
    channelKind: channel.kind,
    campaignSlug: input.utmCampaign ?? null,
    contentTitle: content.title,
  })
  return {
    spaceId,
    contentId: content.id,
    channelId: channel.id,
    shortSlug: generateShortSlug(),
    targetUrl: input.targetUrl,
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
    utmSource: input.utmSource ? normalizeKebab(input.utmSource) : utmDefaults.utmSource,
    utmMedium: input.utmMedium ? normalizeKebab(input.utmMedium) : utmDefaults.utmMedium,
    utmCampaign: input.utmCampaign ? normalizeKebab(input.utmCampaign) : utmDefaults.utmCampaign,
    utmContent: input.utmContent ? normalizeKebab(input.utmContent) : null,
    utmTerm: input.utmTerm ? normalizeKebab(input.utmTerm) : null,
  }
}

/** shortSlug unique 위반만. 다른 unique 위반까지 재시도하면 원래 오류가 DeploymentSlugError 로 가려진다. */
export function isSlugConflict(err: unknown): boolean {
  const e = err as { code?: string; meta?: unknown } | null
  // 드라이버 어댑터마다 meta 모양(target 배열·제약 이름·driverAdapterError)이 달라 문자열로 확인한다.
  return e?.code === 'P2002' && JSON.stringify(e.meta ?? {}).includes('shortSlug')
}

/**
 * shortSlug 충돌(P2002) 시 최대 5회 다시 시도한다. 트랜잭션 안에서는 P2002 가 트랜잭션을 깨뜨리므로
 * 트랜잭션 전체를 다시 돌려야 한다 — run 은 매 시도마다 새 slug 로 처음부터 실행돼야 한다.
 */
export async function withSlugRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < 5; i++) {
    try {
      return await run()
    } catch (err) {
      lastError = err
      if (!isSlugConflict(err)) throw err
    }
  }
  throw new DeploymentSlugError(lastError instanceof Error ? lastError.message : String(lastError))
}

export function createDeployment(
  spaceId: string,
  content: { id: string; title: string },
  channel: DeploymentChannel,
  input: DeploymentInput
) {
  return withSlugRetry(() =>
    prisma.contentDeployment.create({ data: deploymentData(spaceId, content, channel, input) })
  )
}
