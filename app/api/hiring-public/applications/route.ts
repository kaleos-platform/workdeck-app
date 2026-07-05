// 공개 지원 제출 API — 무인증. 남용 방어(레이트리밋·MIME·용량·개수) 필수.
// 단일 멀티파트 POST: payload(JSON) + files(최대 3). spaceId/postingId 는 posting 행에서 파생.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashIp } from '@/lib/sc/utm'
import { errorResponse } from '@/lib/api-helpers'
import { publicApplicationPayloadSchema } from '@/lib/validations/hiring-applicants'
import {
  createPublicApplication,
  checkRateLimit,
  MAX_APPLICANT_FILES,
  type IncomingFile,
} from '@/lib/hiring/applications'
import { ALLOWED_APPLICANT_MIME, MAX_APPLICANT_FILE_BYTES } from '@/lib/hiring/storage'
import type { ApplicationEntryValue } from '@/lib/hiring/pii'

export const runtime = 'nodejs'

/**
 * 신뢰 가능한 클라이언트 IP 추출.
 * XFF 첫 값은 클라이언트가 임의 주입 가능(스푸핑) — 신뢰 순서:
 * 1) x-vercel-forwarded-for (Vercel 플랫폼이 세팅, 클라이언트 위조 불가)
 * 2) XFF 마지막 값(가장 가까운 신뢰 프록시가 기록한 실제 접속 IP)
 * 3) x-real-ip
 */
function clientIp(req: NextRequest): string {
  const vercel = req.headers.get('x-vercel-forwarded-for')
  if (vercel) return vercel.split(',')[0]!.trim()
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]!
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function POST(req: NextRequest) {
  // 레이트리밋(IP 해시 키)
  const ip = clientIp(req)
  const ipKey = ip !== 'unknown' ? hashIp(ip) : 'unknown'
  if (!checkRateLimit(ipKey)) {
    return errorResponse('요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요', 429)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const rawPayload = form.get('payload')
  if (typeof rawPayload !== 'string') {
    return errorResponse('payload 가 필요합니다', 400)
  }

  let payloadJson: unknown
  try {
    payloadJson = JSON.parse(rawPayload)
  } catch {
    return errorResponse('payload JSON 파싱 실패', 400)
  }

  const parsed = publicApplicationPayloadSchema.safeParse(payloadJson)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, {
      issues: parsed.error.flatten().fieldErrors,
    })
  }
  const payload = parsed.data

  // 공고 유효성 — ACTIVE 만 지원 접수. spaceId/postingId 파생.
  const posting = await prisma.hiringPosting.findUnique({
    where: { uuid: payload.postingUuid },
    select: {
      id: true,
      spaceId: true,
      status: true,
      positions: { select: { id: true } },
      stores: { select: { storeId: true } },
    },
  })
  if (!posting || posting.status === 'DRAFT' || posting.status === 'ARCHIVED') {
    return errorResponse('공고를 찾을 수 없습니다', 404)
  }
  if (posting.status !== 'ACTIVE') {
    return errorResponse('마감된 공고입니다', 410)
  }

  // DB 백스톱 캡 — 인메모리 리미터는 서버리스 인스턴스별로 리셋되므로
  // 공고당 시간당 접수 상한을 DB 카운트로 강제한다(스푸핑·콜드스타트 무관).
  // TODO(스케일): 정밀 IP 단위 제한이 필요해지면 Upstash/Redis 공유 스토어로 승격.
  const POSTING_HOURLY_CAP = 60
  const recentCount = await prisma.hiringApplication.count({
    where: { postingId: posting.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  })
  if (recentCount >= POSTING_HOURLY_CAP) {
    return errorResponse('접수가 몰리고 있습니다. 잠시 후 다시 시도해 주세요', 429)
  }

  // 부문·매장은 해당 공고 소속 값만 허용(타 공고/공간 값 주입 차단)
  const validPositionIds = new Set(posting.positions.map((p) => p.id))
  const postingPositionId =
    payload.postingPositionId && validPositionIds.has(payload.postingPositionId)
      ? payload.postingPositionId
      : null
  const validStoreIds = new Set(posting.stores.map((s) => s.storeId))
  const storeIds = (payload.storeIds ?? []).filter((sid) => validStoreIds.has(sid))

  // 파일 수집 + 방어 검증
  const rawFiles = form.getAll('files').filter((f): f is File => f instanceof File)
  if (rawFiles.length > MAX_APPLICANT_FILES) {
    return errorResponse(`첨부는 최대 ${MAX_APPLICANT_FILES}개까지 가능합니다`, 400)
  }
  const files: IncomingFile[] = []
  for (const f of rawFiles) {
    if (f.size === 0) continue
    if (!ALLOWED_APPLICANT_MIME.has(f.type)) {
      return errorResponse('허용되지 않는 파일 형식입니다', 400)
    }
    if (f.size > MAX_APPLICANT_FILE_BYTES) {
      return errorResponse('파일이 용량 제한을 초과했습니다', 400)
    }
    files.push({
      fileName: f.name,
      mimeType: f.type,
      data: Buffer.from(await f.arrayBuffer()),
    })
  }

  // referrer: 클라이언트 payload 우선, 없으면 Referer 헤더
  const referrer = payload.referrer ?? req.headers.get('referer') ?? null

  try {
    const result = await createPublicApplication({
      posting: { id: posting.id, spaceId: posting.spaceId },
      entries: payload.entries as ApplicationEntryValue[],
      postingPositionId,
      storeIds,
      referrer: referrer?.slice(0, 300) ?? null,
      files,
      privacyAgreed: payload.privacyAgreed,
    })
    // 블랙리스트/중복 여부는 응답에 노출하지 않는다(비공개 성공 응답 고정).
    return NextResponse.json({ ok: true, uuid: result.uuid }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : '지원서 제출에 실패했습니다'
    return errorResponse(message, 400)
  }
}
