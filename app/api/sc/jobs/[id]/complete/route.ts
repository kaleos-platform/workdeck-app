import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse, resolveWorkerAuth } from '@/lib/api-helpers'
import { completeJob, failJob } from '@/lib/sc/jobs'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  ok: z.boolean(),
  errorMessage: z.string().max(1000).optional(),
  // publish 성공 시 platformUrl 을 같이 보내면 ContentDeployment 에 채운다.
  platformUrl: z.string().url().max(2000).optional(),
})

export async function POST(req: NextRequest, { params }: Params) {
  const auth = resolveWorkerAuth(req)
  if ('error' in auth) return auth.error

  const { id } = await params
  const job = await prisma.salesContentJob.findUnique({ where: { id } })
  if (!job) return errorResponse('job 이 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  if (parsed.data.ok) {
    await completeJob(id)
    // PUBLISH 성공 시 ContentDeployment 상태 업데이트
    if (job.kind === 'PUBLISH' && job.targetId) {
      await prisma.contentDeployment.update({
        where: { id: job.targetId },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          platformUrl: parsed.data.platformUrl ?? undefined,
          errorMessage: null,
        },
      })
    }
    return NextResponse.json({ ok: true })
  }

  await failJob(id, parsed.data.errorMessage ?? '알 수 없는 오류')
  if (job.kind === 'PUBLISH' && job.targetId) {
    await prisma.contentDeployment.update({
      where: { id: job.targetId },
      data: {
        status: 'FAILED',
        errorMessage: parsed.data.errorMessage?.slice(0, 1000) ?? null,
      },
    })
  }
  return NextResponse.json({ ok: true })
}
