// 수동 채널 게시 완료 처리 — 사람이 플랫폼에 올린 뒤 URL 을 넣으면 배포·콘텐츠를 함께 PUBLISHED 로 만든다.

import { prisma } from '@/lib/prisma'
import type { ContentStatus, SalesContentPlatform } from '@/generated/prisma/client'

const PUBLISHABLE_CONTENT: ContentStatus[] = ['APPROVED', 'SCHEDULED', 'PUBLISHED', 'ANALYZED']

/** 게시 URL 검증·정규화. 네이버는 수집기가 읽는 `blog.naver.com/{id}/{글번호}` 로 맞춘다. 실패 시 null. */
export function normalizePlatformUrl(platform: SalesContentPlatform, raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (platform !== 'BLOG_NAVER') return url.toString()

  if (url.hostname !== 'blog.naver.com' && url.hostname !== 'm.blog.naver.com') return null
  const path = /^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/.exec(url.pathname)
  const blogId = path?.[1] ?? url.searchParams.get('blogId')
  const logNo = path?.[2] ?? url.searchParams.get('logNo')
  if (!blogId || !logNo || !/^\d+$/.test(logNo)) return null
  return `https://blog.naver.com/${blogId}/${logNo}`
}

export type CompleteManualResult =
  | { ok: true; platformUrl: string; alreadyDone: boolean }
  | { ok: false; status: 400 | 404 | 409; message: string }

export async function completeManualDeployment(input: {
  spaceId: string
  deploymentId: string
  platformUrl: string
}): Promise<CompleteManualResult> {
  const { spaceId, deploymentId } = input
  const deployment = await prisma.contentDeployment.findFirst({
    where: { id: deploymentId, spaceId },
    select: { contentId: true, channel: { select: { platform: true, publisherMode: true } } },
  })
  if (!deployment) return { ok: false, status: 404, message: '배포를 찾을 수 없습니다' }
  if (deployment.channel.publisherMode !== 'MANUAL') {
    return { ok: false, status: 409, message: '수동 게시 채널의 배포가 아닙니다' }
  }

  const platformUrl = normalizePlatformUrl(deployment.channel.platform, input.platformUrl)
  if (!platformUrl) {
    return { ok: false, status: 400, message: '게시물 주소가 올바르지 않습니다' }
  }

  const now = new Date()
  return prisma.$transaction(async (tx): Promise<CompleteManualResult> => {
    // 같은 콘텐츠의 배포를 동시에 완료해도 아래 "남은 배포" 판단이 어긋나지 않게 직렬화한다.
    await tx.$queryRaw`SELECT 1 FROM "Content" WHERE "id" = ${deployment.contentId} FOR UPDATE`
    const content = await tx.content.findUnique({
      where: { id: deployment.contentId },
      select: { status: true },
    })
    if (!content || !PUBLISHABLE_CONTENT.includes(content.status)) {
      return { ok: false, status: 409, message: '게시할 수 없는 콘텐츠 상태입니다' }
    }

    // 조건부 전이 — 동시 요청 중 하나만 통과한다.
    const gate = await tx.contentDeployment.updateMany({
      where: { id: deploymentId, spaceId, status: 'AWAITING_MANUAL' },
      data: { status: 'PUBLISHED', platformUrl, publishedAt: now, errorMessage: null },
    })
    if (gate.count === 0) {
      const current = await tx.contentDeployment.findUnique({
        where: { id: deploymentId },
        select: { status: true, platformUrl: true },
      })
      if (current?.status === 'PUBLISHED' && current.platformUrl === platformUrl) {
        return { ok: true, platformUrl, alreadyDone: true }
      }
      return {
        ok: false,
        status: 409,
        message:
          current?.status === 'PUBLISHED'
            ? '이미 다른 주소로 게시 완료된 배포입니다'
            : '게시 대기 상태가 아닙니다',
      }
    }

    // 콘텐츠가 PUBLISHED 가 되면 배포 실행이 막히므로, 다른 채널 배포가 끝난 뒤에 전이한다.
    const open = await tx.contentDeployment.count({
      where: {
        contentId: deployment.contentId,
        status: { in: ['SCHEDULED', 'PUBLISHING', 'AWAITING_MANUAL', 'FAILED'] },
      },
    })
    if (open === 0) {
      await tx.content.updateMany({
        where: { id: deployment.contentId, status: { in: ['APPROVED', 'SCHEDULED'] } },
        data: { status: 'PUBLISHED', publishedAt: now },
      })
    }
    return { ok: true, platformUrl, alreadyDone: false }
  })
}
