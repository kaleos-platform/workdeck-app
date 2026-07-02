import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'

/**
 * GET /api/collection/backfill/worker
 * 워커가 PENDING 잡 1건을 원자적으로 claim 한다.
 *
 * Query: ?workerId=<string>
 * 응답: { job: ClaimedBackfillJob | null }
 *   job 이 null 이면 처리할 잡 없음.
 *   job 이 있으면 credential 정보 포함 (워커가 Wing 세션에 사용).
 */
export async function GET(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  // ?jobId=<id> 가 주어지면 claim 이 아니라 단순 상태 조회(워커의 취소 감지용).
  const statusJobId = request.nextUrl.searchParams.get('jobId')
  if (statusJobId) {
    const job = await prisma.coupangBackfillJob.findUnique({
      where: { id: statusJobId },
      select: { id: true, status: true },
    })
    if (!job) return errorResponse('잡을 찾을 수 없습니다', 404)
    return NextResponse.json({ job })
  }

  const workerId = request.nextUrl.searchParams.get('workerId') ?? `backfill-worker-unknown`

  // 1) 가장 오래된 PENDING 잡 찾기
  const candidate = await prisma.coupangBackfillJob.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })

  if (!candidate) {
    return NextResponse.json({ job: null })
  }

  // 2) 원자적 compare-and-swap: PENDING → RUNNING
  //    다른 워커가 먼저 가져간 경우 count=0
  const updated = await prisma.coupangBackfillJob.updateMany({
    where: { id: candidate.id, status: 'PENDING' },
    data: {
      status: 'RUNNING',
      claimedAt: new Date(),
      claimedBy: workerId,
    },
  })

  if (updated.count === 0) {
    // 레이스 패배 — 빈 응답으로 다음 폴링까지 대기
    return NextResponse.json({ job: null })
  }

  // 3) 잡 + 워크스페이스 자격증명 조회
  const job = await prisma.coupangBackfillJob.findUnique({
    where: { id: candidate.id },
    select: {
      id: true,
      workspaceId: true,
      days: true,
      startDate: true,
      endDate: true,
      status: true,
      claimedAt: true,
      claimedBy: true,
    },
  })

  if (!job) {
    return errorResponse('잡을 찾을 수 없습니다', 404)
  }

  // 4) 해당 워크스페이스의 쿠팡 자격증명 조회
  // DB 컬럼명: loginPassword / encryptionIv
  // 워커 계약상 키: encryptedPassword / passwordIv (api-client.ts CredentialResponse 와 동일)
  const credential = await prisma.coupangCredential.findUnique({
    where: { workspaceId: job.workspaceId },
    select: {
      loginId: true,
      loginPassword: true,
      encryptionIv: true,
    },
  })

  if (!credential) {
    // 자격증명 없으면 즉시 FAILED 처리
    await prisma.coupangBackfillJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: '쿠팡 자격증명이 없습니다',
      },
    })
    return NextResponse.json({ job: null })
  }

  return NextResponse.json({
    job: {
      ...job,
      credential: {
        loginId: credential.loginId,
        encryptedPassword: credential.loginPassword,
        passwordIv: credential.encryptionIv,
      },
    },
  })
}

/**
 * PATCH /api/collection/backfill/worker
 * 워커가 잡 실행 결과를 보고한다.
 *
 * body: {
 *   jobId: string,
 *   status: "DONE" | "FAILED",
 *   collected?: number,  // 다운로드·업로드 성공한 날짜 수
 *   converted?: number,  // OUTBOUND 변환된 레코드 수
 *   error?: string,
 * }
 */
export async function PATCH(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('잘못된 요청 본문입니다', 400)
  }

  const raw = body as Record<string, unknown>
  const {
    jobId,
    status,
    collected,
    converted,
    duplicateRows,
    outboundCount,
    revenueSum,
    orderSum,
    salesQtySum,
    error: jobError,
  } = raw

  if (typeof jobId !== 'string') {
    return errorResponse('jobId 가 필요합니다', 400)
  }
  if (status !== 'DONE' && status !== 'FAILED') {
    return errorResponse('status 는 DONE 또는 FAILED 여야 합니다', 400)
  }

  const job = await prisma.coupangBackfillJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true },
  })

  if (!job) {
    return errorResponse('잡을 찾을 수 없습니다', 404)
  }
  if (job.status !== 'RUNNING') {
    return errorResponse(`잡이 RUNNING 상태가 아닙니다 (현재: ${job.status})`, 409)
  }

  const updated = await prisma.coupangBackfillJob.update({
    where: { id: jobId },
    data: {
      status: status === 'DONE' ? 'DONE' : 'FAILED',
      completedAt: new Date(),
      ...(typeof collected === 'number' && { collected }),
      ...(typeof converted === 'number' && { converted }),
      ...(typeof duplicateRows === 'number' && { duplicateRows }),
      ...(typeof outboundCount === 'number' && { outboundCount }),
      ...(typeof revenueSum === 'number' && { revenueSum }),
      ...(typeof orderSum === 'number' && { orderSum }),
      ...(typeof salesQtySum === 'number' && { salesQtySum }),
      ...(typeof jobError === 'string' && { error: jobError }),
    },
  })

  return NextResponse.json({ job: updated })
}
