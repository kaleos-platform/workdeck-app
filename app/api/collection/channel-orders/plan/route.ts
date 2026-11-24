/**
 * 워커용 채널 주문 관측 일정.
 * GET  — observeEnabled 인 네이버·쿠팡 채널의 어댑터·스토어 키·커서·조회 창(읽기 전용).
 * POST — { channelId, kind: 'OBSERVE' | 'FULL_SCAN' } 실행을 시작한다(OBSERVE 는 lease 를 조건부로 잡는다).
 *        이미 실행 중이면 409. 응답의 operationId 를 ingest·finish 에 그대로 보낸다.
 * start 응답: 네이버는 secret({clientId, clientSecret}|null), 쿠팡은 vendorId(비밀 아님)만 싣는다.
 * 쿠팡 secretKey 는 내려주지 않는다 — 워커가 api-credentials(암호문)로 받아 로컬 복호화한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { planWindows, startFullScan, startObserve } from '@/lib/channel-orders/operations'
import {
  OBSERVE_MAX_WINDOWS,
  SCAN_DAYS,
  type Adapter,
  type ObserveCursor,
} from '@/lib/channel-orders/types'
import { channelOrderErrorResponse, resolveWorkerSpace } from '@/lib/channel-orders/worker-route'
import { loadCoupangVendorId, loadNaverStoreSecret } from '@/lib/channel-orders/worker-secret'

const WORKER_ADAPTERS = ['naver', 'coupang']

export async function GET(request: NextRequest) {
  const resolved = await resolveWorkerSpace(request.headers)
  if ('error' in resolved) return resolved.error
  const now = new Date()
  const rows = await prisma.channelFulfillmentSetting.findMany({
    where: {
      spaceId: resolved.scope.spaceId,
      observeEnabled: true,
      adapter: { in: WORKER_ADAPTERS },
    },
    select: { channelId: true, adapter: true, storeKey: true, observeCursor: true },
  })
  const items = rows.map((r) => {
    const cursor = (r.observeCursor as ObserveCursor | null) ?? null
    return {
      channelId: r.channelId,
      adapter: r.adapter,
      storeKey: r.storeKey,
      cursor,
      windows: planWindows(r.adapter as Adapter, cursor, now, OBSERVE_MAX_WINDOWS).map((w) => ({
        from: w.from.toISOString(),
        to: w.to.toISOString(),
      })),
      scanDays: SCAN_DAYS,
    }
  })
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}

const StartSchema = z.object({
  channelId: z.string().min(1),
  kind: z.enum(['OBSERVE', 'FULL_SCAN']),
})

export async function POST(request: NextRequest) {
  const resolved = await resolveWorkerSpace(request.headers)
  if ('error' in resolved) return resolved.error
  const parsed = StartSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const { channelId, kind } = parsed.data
  const setting = await prisma.channelFulfillmentSetting.findUnique({
    where: { channelId },
    select: { spaceId: true, adapter: true, storeKey: true },
  })
  if (
    !setting ||
    setting.spaceId !== resolved.scope.spaceId ||
    !WORKER_ADAPTERS.includes(setting.adapter)
  ) {
    return errorResponse('채널을 찾을 수 없습니다', 404)
  }
  const now = new Date()
  try {
    // start 성공 뒤에만 조회한다(409 에서 복호화 안 함). 실패해도 null 이라 operation 은 유지 — 워커가 auth_error 로 마감한다.
    const creds = async () =>
      setting.adapter === 'naver'
        ? { secret: await loadNaverStoreSecret(setting.spaceId, setting.storeKey) }
        : { vendorId: await loadCoupangVendorId(setting.spaceId) }
    if (kind === 'FULL_SCAN') {
      const s = await startFullScan(channelId, now)
      return NextResponse.json({
        operationId: s.operationId,
        storeKey: s.storeKey,
        scanDays: SCAN_DAYS,
        ...(await creds()),
        // 서버가 계획한 KST 일자 창 — 이 창만 조회하고 창마다 ingest 한다.
        windows: s.windows.map((w) => ({ from: w.from.toISOString(), to: w.to.toISOString() })),
      })
    }
    const s = await startObserve(channelId, now)
    return NextResponse.json({
      operationId: s.operationId,
      storeKey: s.storeKey,
      cursor: s.cursor,
      ...(await creds()),
      windows: s.windows.map((w) => ({ from: w.from.toISOString(), to: w.to.toISOString() })),
    })
  } catch (err) {
    return channelOrderErrorResponse(err)
  }
}
