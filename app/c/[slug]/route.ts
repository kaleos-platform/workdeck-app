// UTM 리다이렉터 — /c/{slug} → ContentDeployment.targetUrl + UTM 파라미터.
// 302 응답 후 fire-and-forget 으로 ContentClickEvent INSERT.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildTargetUrl, hashIp } from '@/lib/sc/utm'

type Params = { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params

  const deployment = await prisma.contentDeployment.findUnique({
    where: { shortSlug: slug },
    select: {
      id: true,
      spaceId: true,
      status: true,
      targetUrl: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      utmContent: true,
      utmTerm: true,
    },
  })

  if (!deployment) {
    return NextResponse.json({ message: '링크를 찾을 수 없습니다' }, { status: 404 })
  }
  if (deployment.status === 'CANCELED' || deployment.status === 'FAILED') {
    return NextResponse.json({ message: '링크가 비활성화되었습니다' }, { status: 410 })
  }

  const destination = buildTargetUrl(deployment.targetUrl, {
    utmSource: deployment.utmSource,
    utmMedium: deployment.utmMedium,
    utmCampaign: deployment.utmCampaign,
    utmContent: deployment.utmContent,
    utmTerm: deployment.utmTerm,
  })

  // fire-and-forget: await 하지 않음
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  const userAgent = req.headers.get('user-agent') ?? null
  const referrer = req.headers.get('referer') ?? null

  void prisma.contentClickEvent
    .create({
      data: {
        spaceId: deployment.spaceId,
        deploymentId: deployment.id,
        ipHash: ip !== 'unknown' ? hashIp(ip) : null,
        userAgent: userAgent?.slice(0, 500) ?? null,
        referrer: referrer?.slice(0, 500) ?? null,
      },
    })
    .catch(() => {
      // 실패해도 사용자 경험 유지 — 300ms 이내 302 응답 우선
    })

  return NextResponse.redirect(destination, 302)
}
