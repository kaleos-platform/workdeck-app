import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/hiring/applications'
import { publicRequestKey } from '@/lib/hiring/public-request'
import { uploadTokenHash } from '@/lib/hiring/upload-protocol'

const schema = z.object({
  uploadSessionId: z.string().uuid(),
  postingUuid: z.string().min(1).max(100),
  action: z.literal('verify').optional(),
})
const cancelledHash = 'recovery-cancelled-v1'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== req.nextUrl.origin)
    return NextResponse.json({}, { status: 403 })
  if (!checkRateLimit(`recovery:${publicRequestKey(req)}`))
    return NextResponse.json({}, { status: 429 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({}, { status: 400 })
  const { uploadSessionId, postingUuid } = parsed.data
  if (req.nextUrl.pathname.split('/').pop() !== uploadSessionId)
    return NextResponse.json({}, { status: 400 })
  const token = req.cookies.get(`wd-recovery-${uploadSessionId}`)?.value
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({}, { status: 403 })
  const where = {
    id: uploadSessionId,
    tokenHash: uploadTokenHash(token),
    posting: { uuid: postingUuid },
  }
  try {
    if (parsed.data.action === 'verify') {
      const session = await prisma.hiringUploadSession.findFirst({
        where: { ...where, claimedAt: null, completedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      })
      return session
        ? NextResponse.json({ status: 'ready' }, { headers: { 'Cache-Control': 'no-store' } })
        : NextResponse.json({}, { status: 409 })
    }
    const status = await prisma.$transaction(async (tx) => {
      // 완료 요청과 같은 행을 잠가 완료 또는 취소 중 하나만 확정한다.
      const result = await tx.hiringUploadSession.updateMany({
        where: { ...where, claimedAt: null, completedAt: null },
        data: { claimedAt: new Date(), requestHash: cancelledHash },
      })
      if (result.count) return 'cancelled'
      const previous = await tx.hiringUploadSession.findFirst({
        where,
        select: { completedAt: true, applicationId: true, requestHash: true },
      })
      if (previous?.completedAt && previous.applicationId) return 'completed'
      if (previous?.requestHash === cancelledHash) return 'cancelled'
      return null
    })
    if (!status) return NextResponse.json({}, { status: 409 })
    return NextResponse.json({ status }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({}, { status: 503 })
  }
}
