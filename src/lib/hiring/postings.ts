/**
 * 공고 제작(hiring-posts) Deck 서버 전용 도메인 모듈.
 * 모든 조회/변경은 spaceId 로 스코프한다. (라우트 핸들러에서만 호출 — 서버 전용)
 */
import { prisma } from '@/lib/prisma'
import { uploadPostingAsset } from '@/lib/hiring/storage'
import type { FormFieldInput } from '@/lib/validations/hiring-posts'

// ─── 지원서 폼 기본값 ──────────────────────────────────────────────────────────
// 표준 PII 키(name/phone/email/address)는 pii.ts 의 PII_ENTRY_KEYS 와 일치해야 한다.
// name/phone 은 필수 고정(제거 불가), email/address 는 toggle 가능.
export const STANDARD_FIELD_KEYS = ['name', 'phone', 'email', 'address'] as const

export const DEFAULT_FORM_FIELDS: FormFieldInput[] = [
  { key: 'name', type: 'string', label: '이름', required: true },
  { key: 'phone', type: 'phone', label: '연락처', required: true },
  { key: 'email', type: 'email', label: '이메일', required: false },
  { key: 'address', type: 'string', label: '주소', required: false },
]

/** 폼 필드 배열이 필수 표준 항목(name/phone)을 포함하는지 검증 */
export function formHasRequiredStandardFields(fields: FormFieldInput[]): boolean {
  const keys = new Set(fields.map((f) => f.key))
  return keys.has('name') && keys.has('phone')
}

// ─── 공고 목록/상세 조회 ───────────────────────────────────────────────────────
export type PostingListStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED'

/** 공고 목록 (상태 필터 옵션) — 지원자 수·마감일 포함 */
export async function listPostings(spaceId: string, status?: PostingListStatus) {
  return prisma.hiringPosting.findMany({
    where: { spaceId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      uuid: true,
      title: true,
      status: true,
      closingDate: true,
      publishedAt: true,
      createdAt: true,
      _count: { select: { applications: true } },
    },
  })
}

/** 상태별 개수 (탭 배지용) */
export async function countPostingsByStatus(spaceId: string) {
  const grouped = await prisma.hiringPosting.groupBy({
    by: ['status'],
    where: { spaceId },
    _count: { _all: true },
  })
  const counts: Record<string, number> = {}
  for (const g of grouped) counts[g.status] = g._count._all
  return counts
}

/** 공고 상세 (위저드용) — 직무·매장연결·콘텐츠 포함 */
export async function getPostingDetail(spaceId: string, id: string) {
  return prisma.hiringPosting.findFirst({
    where: { id, spaceId },
    include: {
      positions: { orderBy: { createdAt: 'asc' } },
      stores: { select: { id: true, storeId: true } },
      contents: { orderBy: { sortOrder: 'asc' } },
    },
  })
}

/** 공고 소유권 검증 (cross-space 쓰기 방지) — 존재하면 id 반환 */
export async function assertPostingInSpace(spaceId: string, id: string): Promise<boolean> {
  const found = await prisma.hiringPosting.findFirst({
    where: { id, spaceId },
    select: { id: true },
  })
  return !!found
}

// ─── 발행 검증 ─────────────────────────────────────────────────────────────────
export type PublishCheck = {
  ok: boolean
  errors: string[]
}

/** 발행 가능 여부 검증: 제목, 직무 ≥1, 폼에 name+phone */
export async function checkPublishable(spaceId: string, id: string): Promise<PublishCheck> {
  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId },
    select: {
      title: true,
      applicationEntries: true,
      _count: { select: { positions: true } },
    },
  })
  const errors: string[] = []
  if (!posting) return { ok: false, errors: ['공고를 찾을 수 없습니다'] }

  if (!posting.title || posting.title.trim().length === 0) errors.push('제목을 입력하세요')
  if (posting._count.positions < 1) errors.push('직무를 1개 이상 등록하세요')

  const fields = Array.isArray(posting.applicationEntries)
    ? (posting.applicationEntries as unknown as FormFieldInput[])
    : DEFAULT_FORM_FIELDS
  if (!formHasRequiredStandardFields(fields)) {
    errors.push('지원서 폼에 이름·연락처 항목이 필요합니다')
  }

  return { ok: errors.length === 0, errors }
}

// ─── 상세 콘텐츠 이미지 업로드 ─────────────────────────────────────────────────
/** base64(data URL 또는 순수 base64) PNG 를 hiring-assets 버킷에 업로드 */
export async function uploadContentImage(params: {
  spaceId: string
  postingId: string
  imageBase64: string
  mimeType?: string
}): Promise<string> {
  const { spaceId, postingId, imageBase64, mimeType = 'image/png' } = params
  const base64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
  const buffer = Buffer.from(base64, 'base64')
  const { path } = await uploadPostingAsset({
    spaceId,
    postingId,
    data: buffer,
    mimeType,
  })
  return path
}
