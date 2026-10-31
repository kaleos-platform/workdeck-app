import { z } from 'zod'
import { postingPositionSchema, storeSchema, positionSchema } from '@/lib/validations/hiring-posts'
import { migrationHash } from './ledger'

// 법인이 달라 개인정보를 옮기지 않는 신규 이전 packet. 모든 깊이에서 허용 필드만 통과시킨다.
// 담당자·작성자·지원서·rawSnapshot·원본 파일 키 필드는 스키마에 없어서 들어오면 거부된다.
export const OPENING_TRANSFORM_VERSION = 'posting-v2'

const sourceId = z.string().regex(/^[1-9]\d{0,18}$/)
const instant = z.iso.datetime({ offset: true })
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const scalar = z.union([z.string(), z.number(), z.boolean()])

const assetShape = {
  // 원본 S3 키의 sha256. 키 자체는 packet 밖으로 내보내지 않는다.
  ref: sha256,
  sha256,
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
}
const assetSchema = z.strictObject(assetShape)
// 화면에 안 보이는 데이터(삭제 요소·미사용 파일·customData)는 들어오면 거부한다.
const sceneSchema = z
  .strictObject({
    type: z.string().optional(),
    version: z.number().optional(),
    source: z.string().optional(),
    elements: z.array(
      z.looseObject({
        isDeleted: z.literal(false).optional(),
        customData: z.never().optional(),
        fileId: z.string().nullish(),
      })
    ),
    appState: z.strictObject({ viewBackgroundColor: z.string().optional() }).optional(),
    files: z.record(
      z.string(),
      z.strictObject({
        id: z.string(),
        mimeType: assetShape.mimeType,
        dataURL: z.string(),
        created: z.number().optional(),
      })
    ),
  })
  .refine((scene) => {
    const used = new Set(scene.elements.map((element) => element.fileId))
    return Object.keys(scene.files).every((id) => used.has(id))
  })
const resourceSchema = z.strictObject({
  ...assetShape,
  hasSceneSource: z.boolean(),
  scene: sceneSchema.optional(),
})
// enabled 섹션만 싣는다. manager 타입은 없으므로 packet에 있으면 거부된다.
const sectionShape = {
  enabled: z.literal(true),
  name: z.string().optional(),
  resource_id: sourceId.optional(),
  url: z.string().optional(),
  image_key: sha256.optional(),
}
const postingSectionSchema = z.strictObject({
  ...sectionShape,
  type: z.enum([
    'posting_title',
    'company_intro',
    'posting_positions',
    'custom',
    'posting_stores',
    'content',
    'content_link',
    'image',
  ]),
  items: z.array(z.strictObject({ label: z.string(), value: z.string() })).optional(),
})
const templateSectionSchema = z.strictObject({
  ...sectionShape,
  type: z.enum(['content', 'content_link', 'image']),
})
const formEntrySchema = z.strictObject({
  key: z.string(),
  type: z.string(),
  label: z.string(),
  required: z.boolean().optional(),
  items: z.array(z.strictObject({ label: z.string(), value: scalar })).optional(),
  description: z.string().optional(),
  error_message: z.string().optional(),
  placeholder: z.string().optional(),
  max_file_count: z.number().optional(),
  max_file_size: z.number().optional(),
  min_length: z.number().optional(),
  max_length: z.number().optional(),
})
const assetMaps = {
  resources: z.record(sourceId, resourceSchema),
  images: z.record(z.string().regex(/^index:\d+$/), assetSchema),
}

export const postingPacketSchema = z.strictObject({
  sourceSpaceId: sourceId,
  sourcePostingId: sourceId,
  sourceSnapshotAt: instant,
  posting: z.strictObject({
    uuid: z.string().regex(/^[A-Za-z0-9_-]{1,36}$/),
    title: z.string().min(1).max(200),
    status: z.number().int().min(1).max(4),
    createdAt: instant,
    updatedAt: instant,
    closingDate: instant.nullable(),
    applicationEntries: z.array(formEntrySchema),
  }),
  positions: z.array(
    z.strictObject({
      sourceId,
      sourcePositionId: sourceId,
      fields: postingPositionSchema.omit({ positionId: true }).strict(),
      createdAt: instant,
      updatedAt: instant,
    })
  ),
  sourceStoreIds: z.array(sourceId),
  historicalStoreIds: z.array(sourceId),
  content: z.strictObject({
    ...assetMaps,
    detail: z.array(postingSectionSchema),
    detailImage: assetSchema.optional(),
    postingTitle: z.string().optional(),
    companyIntro: z.string().optional(),
    positionsVerified: z.boolean(),
    positionConditionsText: z.string().optional(),
    storesText: z.string().optional(),
    originalApplyUrl: z.url(),
  }),
})
export type PostingPacket = z.output<typeof postingPacketSchema>

export const templatePacketSchema = z.strictObject({
  sourceSpaceId: sourceId,
  sourceTemplateId: sourceId,
  sourceSnapshotAt: instant,
  sourceWebOrigin: z.url(),
  name: z.string().min(1),
  createdAt: instant,
  updatedAt: instant,
  cover: assetSchema.optional(),
  detail: z.array(templateSectionSchema),
  ...assetMaps,
})
export type TemplatePacket = z.output<typeof templatePacketSchema>

const orgTimestamps = { sourceId, createdAt: instant, updatedAt: instant }
export const orgPacketSchema = z.strictObject({
  sourceSpaceId: sourceId,
  sourceSnapshotAt: instant,
  stores: z.array(
    z.strictObject({
      ...orgTimestamps,
      name: storeSchema.shape.name,
      roadAddress: z.string().max(300).optional(),
      detailAddress: z.string().max(300).optional(),
      zipcode: z.string().max(20).optional(),
      isActive: z.boolean(),
    })
  ),
  positions: z.array(
    z.strictObject({
      ...orgTimestamps,
      name: positionSchema.shape.name,
      category: z.string().max(100).optional(),
      isActive: z.boolean(),
    })
  ),
})
export type OrgPacket = z.output<typeof orgPacketSchema>

const KST_MS = 9 * 60 * 60 * 1000

// C = T의 한국 날짜에서 12개월 전 00:00 KST. 대응 월에 같은 날이 없으면 말일로 맞춘다(2/29 → 2/28).
export function migrationWindowStart(snapshotAt: Date): Date {
  const kst = new Date(snapshotAt.getTime() + KST_MS)
  const year = kst.getUTCFullYear() - 1
  const month = kst.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(kst.getUTCDate(), lastDay)) - KST_MS)
}

export function kstDate(value: Date | string): string {
  return new Date(new Date(value).getTime() + KST_MS).toISOString().slice(0, 10)
}

export function isInMigrationWindow(
  posting: { createdAt: string | Date; updatedAt: string | Date },
  snapshotAt: Date
): boolean {
  const start = migrationWindowStart(snapshotAt).getTime()
  return (
    new Date(posting.createdAt).getTime() >= start || new Date(posting.updatedAt).getTime() >= start
  )
}

const SEPARATOR = '[\\s.\\-\\u2010-\\u2015\\u2212/\\u00b7\\u2022()]{0,3}'
// 해시·긴 id 안의 숫자열은 적중으로 세지 않도록 앞뒤가 영숫자이면 제외한다.
const PHONE = new RegExp(
  `(?<![0-9A-Za-z])(?:\\+?82${SEPARATOR}0?${SEPARATOR}1[016789]|050\\d|01[016789]|0[2-9]\\d?)${SEPARATOR}\\d{3,4}${SEPARATOR}\\d{4}(?![0-9A-Za-z])`,
  'g'
)
const EMAIL =
  /[A-Za-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gi
const KEYWORD = /담당자|연락처|채용\s*문의|오픈\s*채팅|open\.?kakao/gi
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi
const SENSITIVE_PARAM = /token|signature|secret|passw|^sig$|^key$|api_?key|^auth|^x-amz-/i

function isSensitiveUrl(value: string): boolean {
  try {
    const url = new URL(value.replace(/[),.]+$/, ''))
    return (
      !!(url.username || url.password) ||
      [...url.searchParams.keys()].some((name) => SENSITIVE_PARAM.test(name))
    )
  } catch {
    return false
  }
}

export type ContactHits = { phone: number; email: number; keyword: number; url: number }
export const emptyHits = (): ContactHits => ({ phone: 0, email: 0, keyword: 0, url: 0 })
// 사람이 풀어 줄 수 있는 적중. 민감 URL은 원본에서 고쳐야 하므로 세지 않는다.
export const contactCount = (hits: ContactHits) => hits.phone + hits.email + hits.keyword

function scanText(raw: string, hits: ContactHits, trail: string[]) {
  const value = raw.normalize('NFKC')
  hits.phone += value.match(PHONE)?.length ?? 0
  hits.email += value.match(EMAIL)?.length ?? 0
  // 지원서 폼의 표준 문항명(연락처)은 개인 연락처가 아니다.
  if (!trail.includes('applicationEntries')) hits.keyword += value.match(KEYWORD)?.length ?? 0
  hits.url += (value.match(URL_PATTERN) ?? []).filter(isSensitiveUrl).length
}

// base64 숫자열 오탐을 막으려고 scene.files[*].dataURL만 건너뛴다. 이미지 안 글자는 수동 검수 대상이다.
const isSceneImageData = (trail: string[], key: string) =>
  key === 'dataURL' && trail.at(-2) === 'files' && (trail.length === 2 || trail.at(-3) === 'scene')

function walkStrings(
  value: unknown,
  visit: (text: string, trail: string[]) => void,
  trail: string[]
) {
  if (typeof value === 'string') visit(value, trail)
  else if (Array.isArray(value)) value.forEach((item) => walkStrings(item, visit, trail))
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (isSceneImageData(trail, key)) continue
      visit(key, trail)
      walkStrings(item, visit, [...trail, key])
    }
  }
}

export function scanContacts(value: unknown, hits: ContactHits = emptyHits()) {
  walkStrings(value, (text, trail) => scanText(text, hits, trail), [])
  return hits
}

// 검토자가 읽을 문자열. 구조값(해시·색상·id)을 빼고 적중 문자열을 앞에 둔다.
export function reviewTexts(value: unknown) {
  const texts: { path: string; text: string; flagged: boolean }[] = []
  walkStrings(
    value,
    (text, trail) => {
      if (!/[가-힣]|\s|@|https?:/.test(text)) return
      const hits = emptyHits()
      scanText(text, hits, trail)
      texts.push({ path: trail.join('.'), text, flagged: contactCount(hits) + hits.url > 0 })
    },
    []
  )
  return texts.sort((a, b) => Number(b.flagged) - Number(a.flagged))
}

// 승인은 내용에 묶인다. T만 달라진 재준비는 다시 검토하지 않아도 된다.
export const reviewHash = (packet: { sourceSnapshotAt: string }) =>
  migrationHash(JSON.parse(JSON.stringify({ ...packet, sourceSnapshotAt: null })))

type Asset = z.output<typeof assetSchema>
// OCR이 없어 글자를 읽지 못한 이미지는 사람이 본다. 내장 이미지 없는 scene의 내보내기만 예외다.
export function unreadImages(
  content: Pick<PostingPacket['content'], 'resources' | 'images'>,
  extra: (Asset | undefined)[] = []
): string[] {
  const unread = [
    ...extra.filter((asset) => !!asset),
    ...Object.values(content.images),
    ...Object.values(content.resources).filter(
      (resource) => !resource.scene || Object.keys(resource.scene.files).length > 0
    ),
  ]
  return [...new Set(unread.map((asset) => asset.sha256))]
}

const reviewFileSchema = z.strictObject({
  sourceSpaceId: sourceId,
  reviewer: z.string().trim().min(1).max(100),
  reviewedAt: z.iso.date(),
  items: z.array(
    z.strictObject({
      kind: z.enum(['posting', 'template']),
      id: sourceId,
      contentHash: sha256,
    })
  ),
  images: z.array(sha256),
})
export type ReviewApprovals = {
  reviewer: string
  reviewedAt: string
  items: Map<string, string>
  images: Set<string>
}

export function parseReviewFile(raw: unknown, sourceSpaceId: string): ReviewApprovals {
  const parsed = reviewFileSchema.safeParse(raw)
  if (!parsed.success) throw Error('REVIEW_FILE_INVALID')
  if (parsed.data.sourceSpaceId !== sourceSpaceId) throw Error('REVIEW_SCOPE_MISMATCH')
  return {
    reviewer: parsed.data.reviewer,
    reviewedAt: parsed.data.reviewedAt,
    items: new Map(parsed.data.items.map((item) => [`${item.kind}:${item.id}`, item.contentHash])),
    images: new Set(parsed.data.images),
  }
}
