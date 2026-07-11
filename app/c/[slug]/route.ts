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

  let destination: string
  try {
    destination = buildTargetUrl(deployment.targetUrl, {
      utmSource: deployment.utmSource,
      utmMedium: deployment.utmMedium,
      utmCampaign: deployment.utmCampaign,
      utmContent: deployment.utmContent,
      utmTerm: deployment.utmTerm,
    })
  } catch {
    // targetUrl 이 잘못된 URL 이면 UTM 없이 원본으로 리다이렉트 시도; 그것도 불가하면 410.
    try {
      return NextResponse.redirect(deployment.targetUrl, 302)
    } catch {
      return NextResponse.json({ message: '링크 대상 URL 이 올바르지 않습니다' }, { status: 410 })
    }
  }

  // fire-and-forget: await 하지 않음
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  const userAgent = req.headers.get('user-agent') ?? null
  const referrer = req.headers.get('referer') ?? null

  // hashIp 는 production 에서 CLICK_EVENT_SALT 미설정 시 throw — 동기 호출이므로
  // data 객체 생성 전에 분리해 try/catch 로 감싼다 (클릭 기록은 best-effort).
  let ipHash: string | null = null
  try {
    ipHash = ip !== 'unknown' ? hashIp(ip) : null
  } catch (e) {
    console.warn('[c/slug] hashIp 실패 — 클릭 기록에서 IP 해시 생략:', e)
  }

  void prisma.contentClickEvent
    .create({
      data: {
        spaceId: deployment.spaceId,
        deploymentId: deployment.id,
        ipHash,
        userAgent: userAgent?.slice(0, 500) ?? null,
        referrer: referrer?.slice(0, 500) ?? null,
      },
    })
    .catch(() => {
      // 실패해도 사용자 경험 유지 — 300ms 이내 302 응답 우선
    })

  return NextResponse.redirect(destination, 302)
}
