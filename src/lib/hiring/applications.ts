// 지원자 관리 Deck 도메인 모듈 — 공개 지원 생성·목록·복호화·레이트리밋·블랙리스트 매칭.
// PII 처리는 반드시 src/lib/hiring/pii.ts 유틸을 거친다(call-site 강제).
import { prisma } from '@/lib/prisma'
import {
  buildApplicationPii,
  decryptApplicationPii,
  hmacHash,
  normalizePhone,
  type ApplicationEntryValue,
} from '@/lib/hiring/pii'
import { decryptPii } from '@/lib/del/encryption'
import {
  uploadApplicantFile,
  removeApplicantFiles,
  ALLOWED_APPLICANT_MIME,
  MAX_APPLICANT_FILE_BYTES,
} from '@/lib/hiring/storage'
import type {
  HiringApplicationStage,
  HiringProcessStage,
  HiringNotificationType,
} from '@/generated/prisma/client'

export * from './application-shared'
export type { ApplicationListRow } from './application-shared'
import { STAGE_LABELS, PROCESS_STAGE_LABELS, NOTIFICATION_LABELS } from './application-shared'
import type { ApplicationListRow } from './application-shared'

export const MAX_APPLICANT_FILES = 3

// ─── 레이트리밋(공개 제출 남용 방어) ────────────────────────────────────────
// 모듈 레벨 Map 슬라이딩 윈도우. ⚠️ 서버리스(멀티 인스턴스)에서는 인스턴스별로만
// 유효하다 — 강한 방어가 필요하면 Redis 등 공유 스토어로 승격해야 한다.
const RATE_WINDOWS = [
  { windowMs: 60_000, max: 5 }, // 분당 5회
  { windowMs: 3_600_000, max: 20 }, // 시간당 20회
]
const ipHits = new Map<string, number[]>()

/** true = 허용, false = 차단 */
export function checkRateLimit(ipKey: string): boolean {
  const now = Date.now()
  const maxWindow = Math.max(...RATE_WINDOWS.map((w) => w.windowMs))
  const prev = ipHits.get(ipKey) ?? []
  const recent = prev.filter((t) => now - t < maxWindow)
  for (const w of RATE_WINDOWS) {
    const count = recent.filter((t) => now - t < w.windowMs).length
    if (count >= w.max) {
      ipHits.set(ipKey, recent)
      return false
    }
  }
  recent.push(now)
  ipHits.set(ipKey, recent)
  // 메모리 누수 방지: 가끔 오래된 IP 정리
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      if (v.every((t) => now - t >= maxWindow)) ipHits.delete(k)
    }
  }
  return true
}

// ─── 공개 지원 생성 ──────────────────────────────────────────────────────────

export type IncomingFile = {
  fileName: string
  mimeType: string
  data: Buffer
}

/**
 * 공개 지원서 생성. spaceId/postingId 는 반드시 posting 행에서 파생(클라이언트 값 신뢰 금지).
 * 중복(phoneHash)·블랙리스트는 내부 플래그로만 처리하고 지원자에게 노출하지 않는다.
 */
export async function createPublicApplication(params: {
  posting: { id: string; spaceId: string }
  entries: ApplicationEntryValue[]
  postingPositionId?: string | null
  storeIds?: string[]
  referrer?: string | null
  files: IncomingFile[]
  privacyAgreed: boolean
}): Promise<{ uuid: string; id: string }> {
  const { posting, entries, files } = params

  // 파일 사전 검증(허용 MIME·용량·개수)
  if (files.length > MAX_APPLICANT_FILES) {
    throw new Error(`첨부는 최대 ${MAX_APPLICANT_FILES}개까지 가능합니다`)
  }
  for (const f of files) {
    if (!ALLOWED_APPLICANT_MIME.has(f.mimeType)) throw new Error('허용되지 않는 파일 형식입니다')
    if (f.data.byteLength > MAX_APPLICANT_FILE_BYTES)
      throw new Error('파일이 용량 제한을 초과했습니다')
  }

  const { columns, sanitizedEntries } = buildApplicationPii(entries)

  // 중복 판정: 같은 postingId + phoneHash
  let duplicated = false
  if (columns.phoneHash) {
    const dupe = await prisma.hiringApplication.findFirst({
      where: { postingId: posting.id, phoneHash: columns.phoneHash, deletedAt: null },
      select: { id: true },
    })
    duplicated = !!dupe
  }

  // 지원서 생성(파일 경로는 applicationId 필요 → 생성 후 업로드)
  const application = await prisma.hiringApplication.create({
    data: {
      spaceId: posting.spaceId,
      postingId: posting.id,
      postingPositionId: params.postingPositionId ?? null,
      applicationEntries: sanitizedEntries as unknown as object,
      ...columns,
      referrer: params.referrer ?? null,
      duplicated,
      privacyAgreedAt: params.privacyAgreed ? new Date() : null,
      stores: params.storeIds?.length
        ? { create: params.storeIds.map((storeId) => ({ storeId })) }
        : undefined,
    },
    select: { id: true, uuid: true },
  })

  // 첨부 업로드 + 메타 저장 — 중간 실패 시 지원서 행·기업로드 파일을 보상 삭제해
  // "첨부 일부만 남은 지원서"가 생기지 않게 한다.
  const uploadedPaths: string[] = []
  try {
    for (const f of files) {
      const { path } = await uploadApplicantFile({
        spaceId: posting.spaceId,
        applicationId: application.id,
        data: f.data,
        mimeType: f.mimeType,
      })
      uploadedPaths.push(path)
      await prisma.hiringApplicationFile.create({
        data: {
          spaceId: posting.spaceId,
          applicationId: application.id,
          fileName: f.fileName.slice(0, 200),
          filePath: path,
          mimeType: f.mimeType,
          sizeBytes: f.data.byteLength,
        },
      })
    }
  } catch (err) {
    await Promise.allSettled([
      removeApplicantFiles(uploadedPaths),
      prisma.hiringApplication.delete({ where: { id: application.id } }),
    ])
    throw err instanceof Error ? err : new Error('첨부 업로드에 실패했습니다')
  }

  return { uuid: application.uuid, id: application.id }
}

// ─── 목록 조회(고용주 콘솔) ──────────────────────────────────────────────────

export type ApplicationListFilters = {
  postingId?: string
  stage?: HiringApplicationStage
  from?: Date
  to?: Date
  page: number
  pageSize: number
}

/** 교차 목록 — spaceId 스코프 필수. 블랙리스트는 phoneHash 조인으로 내부 표시. */
export async function listApplications(
  spaceId: string,
  filters: ApplicationListFilters
): Promise<{ rows: ApplicationListRow[]; total: number }> {
  const where = {
    spaceId,
    deletedAt: null,
    ...(filters.postingId ? { postingId: filters.postingId } : {}),
    ...(filters.stage ? { stage: filters.stage } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  }

  const [records, total, blacklist] = await Promise.all([
    prisma.hiringApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      select: {
        id: true,
        maskedName: true,
        stage: true,
        hiringStage: true,
        duplicated: true,
        phoneHash: true,
        createdAt: true,
        posting: { select: { title: true } },
      },
    }),
    prisma.hiringApplication.count({ where }),
    prisma.hiringBlacklist.findMany({
      where: { spaceId, isActive: true },
      select: { phoneHash: true },
    }),
  ])

  const blacklistSet = new Set(blacklist.map((b) => b.phoneHash))

  const rows: ApplicationListRow[] = records.map((r) => ({
    id: r.id,
    maskedName: r.maskedName ?? '(이름 없음)',
    postingTitle: r.posting?.title ?? '(삭제된 공고)',
    stage: r.stage,
    hiringStage: r.hiringStage,
    createdAt: r.createdAt.toISOString(),
    duplicated: r.duplicated,
    blacklisted: r.phoneHash ? blacklistSet.has(r.phoneHash) : false,
  }))

  return { rows, total }
}

// ─── 상세 조회 + 복호화(서버 전용) ──────────────────────────────────────────

/** 상세 화면·export 전용. 복호화 값은 절대 클라이언트 번들/공개 응답으로 넘기지 않는다. */
export async function getApplicationDetail(spaceId: string, id: string) {
  const app = await prisma.hiringApplication.findFirst({
    where: { id, spaceId, deletedAt: null },
    include: {
      posting: { select: { id: true, title: true, uuid: true } },
      postingPosition: { select: { name: true } },
      stores: { include: { store: { select: { name: true } } } },
      files: {
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, userId: true, content: true, editedAt: true, createdAt: true },
      },
      notifications: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          notiType: true,
          detailMessage: true,
          uuid: true,
          tokenExpireAt: true,
          createdAt: true,
        },
      },
    },
  })
  if (!app) return null

  const pii = decryptApplicationPii(app)
  const blacklisted = app.phoneHash
    ? !!(await prisma.hiringBlacklist.findFirst({
        where: { spaceId, phoneHash: app.phoneHash, isActive: true },
        select: { id: true },
      }))
    : false

  return { app, pii, blacklisted }
}

/** 블랙리스트 매칭 키(복호화된 전화번호로 재현) */
export function phoneHashFromPlain(phone: string): string {
  return hmacHash(normalizePhone(phone))
}

/** 전화번호 마스킹: 01012345678 → 010-****-5678 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '****'
  const prefix = digits.length >= 7 ? digits.slice(0, 3) : '010'
  return `${prefix}-****-${digits.slice(-4)}`
}

/** 블랙리스트 전화(enc/iv) 복호화 + 마스킹 — 서버 전용, 평문 미노출 */
export function decryptBlacklistPhoneMasked(phoneEnc: string, phoneIv: string): string {
  try {
    return maskPhone(decryptPii(phoneEnc, phoneIv))
  } catch {
    return '****'
  }
}
