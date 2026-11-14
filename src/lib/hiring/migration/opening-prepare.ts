import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { z } from 'zod'
import { planOpeningForm } from '@/lib/hiring/opening-form-migration'
import { planPosting, planTemplate, type AssetBinder } from './opening-import'
import {
  contactCount,
  emptyHits,
  embeddedImages,
  isInMigrationWindow,
  kstDate,
  migrationWindowStart,
  orgPacketSchema,
  parseReviewFile,
  postingPacketSchema,
  reviewHash,
  reviewTexts,
  scanContacts,
  templatePacketSchema,
  unreadImages,
  type ContactHits,
  type OrgPacket,
  type PostingPacket,
  type ReviewApprovals,
  type TemplatePacket,
} from './opening-packet'
import {
  cleanImage,
  lossyCompress,
  failureLabel,
  imageDiagKey,
  sanitizeScene,
  sniffImage,
  sniffLabel,
} from './opening-sanitize'

// 원본 조회는 필요한 컬럼만 지정한다. 담당자·작성자·회원·지원서 컬럼/테이블은 절대 읽지 않는다.
export type OpeningSourceClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
}
export type OpeningObjectReader = (object: { bucket: string; key: string }) => Promise<Uint8Array>

type Row = Record<string, unknown>
type Asset = PostingPacket['content']['images'][string]
type Section = PostingPacket['content']['detail'][number]
type Resource = PostingPacket['content']['resources'][string]

type PostingOverview = { id: string; status: number; created_at: Date; updated_at: Date }
type ContentRow = {
  id: string
  status: number
  content_type: string
  image_key: string | null
  file_key: string | null
  owner_brand_id: string | null
}
type FileRow = {
  file_key: string
  status: number
  target_type: string
  storage_type: string
  storage: string
  owner_brand_id: string | null
}

const POSTING_IMAGE_TARGETS = ['posting_detail_img', 'posting_detail', 'content_image']
const SECTION_ATTRIBUTES = new Set([
  'type',
  'enabled',
  'uuid',
  'resource_id',
  'name',
  'url',
  'image_key',
  'file_key',
  'image_url',
  'image_download_url',
  'items',
])
const JOB_TYPES: Record<string, string> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACT',
  free_lancer: 'FREELANCER',
  intern: 'INTERN',
}
const PAY_FREQUENCIES: Record<string, string> = {
  hourly: 'HOURLY',
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
  per_task: 'PER_TASK',
  tbd: 'TBD',
}
const EXPERIENCE: Record<string, string> = {
  no_exp: '신입',
  experienced: '경력',
  all: '경력 무관',
}
const EDUCATION: Record<string, string> = {
  all: '학력 무관',
  high: '고등학교 졸업',
  cc: '대학 졸업 (2, 3년)',
  univ: '대학교 졸업 (4년)',
  master: '석사 졸업',
  phd: '박사 졸업',
}
const FIXED_WORK_DAYS: Record<string, number[]> = {
  mon_to_fri: [1, 2, 3, 4, 5],
  mon_to_sat: [1, 2, 3, 4, 5, 6],
}

export async function readOpeningSource(client: OpeningSourceClient, brandId: string) {
  const select = async <T>(sql: string, params: unknown[]) =>
    (await client.query(sql, params)).rows as T[]
  // 같은 시점을 보도록 REPEATABLE READ로 묶는다. READ ONLY라 쓰기는 DB가 거부한다.
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const [{ snapshot_at: snapshotAt }] = await select<{ snapshot_at: Date }>(
      'SELECT now() AS snapshot_at',
      []
    )
    const [brand] = await select<{ id: string; name: string }>(
      'SELECT id::text, name FROM brand WHERE id = $1',
      [brandId]
    )
    if (!brand) throw Error('SOURCE_BRAND_NOT_FOUND')
    const overview = await select<PostingOverview>(
      'SELECT id::text, status, created_at, updated_at FROM posting WHERE brand_id = $1',
      [brandId]
    )
    const inWindow = overview
      .filter(
        (p) =>
          p.status !== 0 &&
          isInMigrationWindow({ createdAt: p.created_at, updatedAt: p.updated_at }, snapshotAt)
      )
      .map((p) => p.id)
    const postings = await select<Row>(
      `SELECT id::text, uuid, status, title, created_at, updated_at, closing_date, posting_title,
        company_intro, detail, application_entries, detail_image_key
      FROM posting WHERE id = ANY($1::bigint[])`,
      [inWindow]
    )
    const postingPositions = await select<Row>(
      `SELECT id::text, posting_id::text, position_id::text, name, job_type, job_experience,
        pay_frequency, pay_amount, scheduled_work, job_days_custom, job_hours_custom,
        probation_months, contract_months, fixed_work_schedule_type, work_days, work_start_time,
        work_end_time, intake, unknown_intake, job_description, education, required_qualifications,
        preferred_qualifications, created_at, updated_at
      FROM posting_position WHERE posting_id = ANY($1::bigint[]) AND status = 1`,
      [inWindow]
    )
    const postingStores = await select<{ posting_id: string; store_id: string }>(
      `SELECT posting_id::text, store_id::text FROM posting_store
      WHERE posting_id = ANY($1::bigint[]) AND status = 1`,
      [inWindow]
    )
    const stores = await select<Row>(
      `SELECT s.id::text, s.status, s.name, s.created_at, s.updated_at, a.original_address,
        a.original_addr1, a.original_addr2, a.zipcode
      FROM store s LEFT JOIN address a ON a.id = s.address_id
      WHERE s.brand_id = $1 AND (s.status = 1 OR s.id = ANY($2::bigint[]))`,
      [brandId, postingStores.map((row) => row.store_id)]
    )
    const positions = await select<Row>(
      `SELECT id::text, status, name, category_name, created_at, updated_at FROM position
      WHERE brand_id = $1 AND (status = 1 OR id = ANY($2::bigint[]))`,
      [brandId, postingPositions.map((row) => row.position_id)]
    )
    const templates = await select<Row>(
      `SELECT id::text, name, image_key, data, created_at, updated_at FROM detail_template
      WHERE brand_id = $1 AND status = 1`,
      [brandId]
    )
    const sections = [...postings.map((p) => p.detail), ...templates.map((t) => t.data)].flatMap(
      (detail) => (Array.isArray(detail) ? (detail as Row[]) : [])
    )
    const resourceIds = [
      ...new Set(sections.flatMap((s) => (s?.resource_id ? [String(s.resource_id)] : []))),
    ]
    // content에는 brand_id가 없어 원본 source 관계로 소유 고객을 확인한다.
    const contents = await select<ContentRow>(
      `SELECT c.id::text, c.status, c.content_type, c.file_key, c.image_key,
        CASE WHEN c.source_type = 'posting_detail' THEN p.brand_id::text
          WHEN c.source_type = 'detail_template' THEN dt.brand_id::text END AS owner_brand_id
      FROM content c LEFT JOIN posting p ON c.source_type = 'posting_detail' AND p.id = c.source_id
      LEFT JOIN detail_template dt ON c.source_type = 'detail_template' AND dt.id = c.source_id
      WHERE c.id = ANY($1::bigint[])`,
      [resourceIds]
    )
    const keys = [
      ...postings.map((p) => p.detail_image_key),
      ...templates.map((t) => t.image_key),
      ...sections.map((s) => s?.image_key),
      ...contents.flatMap((c) => [c.image_key, c.file_key]),
    ].filter((key): key is string => typeof key === 'string' && key.length > 0)
    // target_id는 처음 쓴 공고/콘텐츠다. 복사본은 파일 키를 공유하므로 공통 샘플 키는 따로 모은다.
    const files = await select<FileRow>(
      `SELECT f.file_key, f.status, f.target_type, f.storage_type, f.storage,
        COALESCE(fp.brand_id, cp.brand_id, cdt.brand_id)::text AS owner_brand_id
      FROM file f
      LEFT JOIN posting fp ON f.target_type IN ('posting_detail_img', 'posting_detail')
        AND fp.id = f.target_id
      LEFT JOIN content fc ON f.target_type IN ('content_image', 'content_data')
        AND fc.id = f.target_id
      LEFT JOIN posting cp ON fc.source_type = 'posting_detail' AND cp.id = fc.source_id
      LEFT JOIN detail_template cdt ON fc.source_type = 'detail_template' AND cdt.id = fc.source_id
      WHERE f.file_key = ANY($1::text[])`,
      [[...new Set(keys)]]
    )
    const [sampleSetting] = await select<{ setting_value: unknown }>(
      `SELECT setting_value FROM setting
      WHERE setting_key = 'detail_template_samples' AND status = 1 LIMIT 1`,
      []
    )
    const sampleIds = parseSampleIds(sampleSetting?.setting_value)
    const sampleTemplates = await select<Row>(
      'SELECT id::text, status, image_key, data FROM detail_template WHERE id = ANY($1::bigint[]) AND status = 1',
      [sampleIds]
    )
    const sampleContents = await select<Row>(
      `SELECT id::text, source_id::text, status, image_key FROM content
      WHERE source_type = 'detail_template' AND source_id = ANY($1::bigint[]) AND status = 1`,
      [sampleIds]
    )
    const sharedKeys = new Set<string>()
    for (const template of sampleTemplates) {
      if (template.status !== 1 || !sampleIds.includes(String(template.id))) continue
      if (typeof template.image_key === 'string' && template.image_key)
        sharedKeys.add(template.image_key)
      for (const section of Array.isArray(template.data) ? (template.data as Row[]) : []) {
        if (
          !section ||
          section.enabled !== true ||
          !['image', 'content', 'content_link'].includes(String(section.type))
        )
          continue
        if (typeof section.image_key === 'string' && section.image_key)
          sharedKeys.add(section.image_key)
        if (section.type === 'image') continue
        const content = sampleContents.find(
          (row) =>
            row.status === 1 &&
            String(row.id) === String(section.resource_id) &&
            String(row.source_id) === String(template.id)
        )
        if (content && typeof content.image_key === 'string' && content.image_key)
          sharedKeys.add(content.image_key)
      }
    }
    await client.query('COMMIT')
    return {
      snapshotAt,
      brand,
      overview,
      postings,
      postingPositions,
      postingStores,
      stores,
      positions,
      templates,
      contents,
      files,
      sharedKeys,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
type OpeningSource = Awaited<ReturnType<typeof readOpeningSource>>

function parseSampleIds(value: unknown): string[] {
  try {
    const list: unknown = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(list) ? list.map(String).filter((id) => /^[1-9]\d{0,18}$/.test(id)) : []
  } catch {
    return []
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const iso = (value: unknown) => new Date(value as Date).toISOString()
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

function mapPosition(row: Row, warn: (code: string) => void) {
  const jobType = text(row.job_type)
  const payFrequency = text(row.pay_frequency)
  const experience = text(row.job_experience)
  const education = text(row.education)
  if (jobType && jobType !== 'recruiting' && !JOB_TYPES[jobType]) warn('JOB_TYPE_UNMAPPED')
  if (payFrequency && !PAY_FREQUENCIES[payFrequency]) warn('PAY_FREQUENCY_UNMAPPED')
  if (experience && !EXPERIENCE[experience]) warn('EXPERIENCE_UNMAPPED')
  if (education && !EDUCATION[education]) warn('EDUCATION_UNMAPPED')
  const sourceDays = Array.isArray(row.work_days) ? (row.work_days as number[]) : []
  const days = sourceDays.length
    ? sourceDays
    : (FIXED_WORK_DAYS[text(row.fixed_work_schedule_type)] ?? [])
  const workDays = days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) ? days : []
  if (workDays.length !== days.length) warn('WORK_DAYS_UNMAPPED')
  const fixedHours = row.scheduled_work !== true
  const time = (value: unknown) => {
    const match = text(value).match(/^([01]\d|2[0-3]):([0-5]\d)/)
    return fixedHours && match ? `${match[1]}:${match[2]}` : undefined
  }
  const workStartAt = time(row.work_start_time)
  const workEndAt = time(row.work_end_time)
  const name = text(row.name)
  // Workdeck 직무 컬럼에 대응이 없는 조건은 본문 문구로 남긴다.
  const notes = [
    jobType === 'recruiting' ? '일반 모집' : '',
    row.contract_months ? `근무 ${row.contract_months}개월` : '',
    row.probation_months ? `수습 ${row.probation_months}개월` : '',
    workDays.length ? '' : text(row.job_days_custom),
    workStartAt && workEndAt ? '' : text(row.job_hours_custom),
  ].filter(Boolean)
  const optional = {
    jobType: JOB_TYPES[jobType],
    payFrequency: PAY_FREQUENCIES[payFrequency],
    payAmount: typeof row.pay_amount === 'number' ? row.pay_amount : undefined,
    workDays: workDays.length ? workDays : undefined,
    workStartAt,
    workEndAt,
    headcount:
      row.unknown_intake !== true && typeof row.intake === 'number' ? row.intake : undefined,
    experience: EXPERIENCE[experience],
    education: EDUCATION[education],
    jobDescription: text(row.job_description) || undefined,
    requiredQualifications: text(row.required_qualifications) || undefined,
    preferredQualifications: text(row.preferred_qualifications) || undefined,
  }
  return {
    position: {
      sourceId: String(row.id),
      sourcePositionId: String(row.position_id),
      fields: {
        name,
        ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
      },
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    },
    note: notes.length ? `${name}: ${notes.join(', ')}` : '',
  }
}

const FORM_ATTRIBUTES = [
  'key',
  'type',
  'label',
  'required',
  'description',
  'error_message',
  'placeholder',
  'max_file_count',
  'max_file_size',
  'min_length',
  'max_length',
]
function formDefinition(entries: unknown) {
  return (entries as Row[]).map((entry) => ({
    ...Object.fromEntries(
      FORM_ATTRIBUTES.flatMap((key) =>
        entry[key] === undefined || entry[key] === null ? [] : [[key, entry[key]]]
      )
    ),
    ...(Array.isArray(entry.items) && entry.items.length
      ? { items: (entry.items as Row[]).map(({ label, value }) => ({ label, value })) }
      : {}),
  }))
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const blocked = message.match(/^Migration (form|content) blocked: ([A-Za-z_]+)$/)
  if (blocked) return `${blocked[1].toUpperCase()}_${blocked[2].toUpperCase()}`
  if (message === 'Migration design exceeds editable size') return 'DESIGN_TOO_LARGE'
  if (/^[A-Z][A-Z_]{2,80}$/.test(message)) return message
  return 'PLAN_BLOCKED'
}

type ManifestEntry = {
  id: string
  status: 'included' | 'held' | 'excluded'
  reasons: string[]
  warnings: string[]
  contactHits: ContactHits
  imageSha256: string[]
  released?: boolean
}
const newEntry = (id: string, status: ManifestEntry['status']): ManifestEntry => ({
  id,
  status,
  reasons: [],
  warnings: [],
  contactHits: emptyHits(),
  imageSha256: [],
})

// 경로만 남긴다. 숫자(인덱스·id)와 영문 필드명이 아닌 조각은 원문일 수 있어 가린다.
const maskPart = (part: PropertyKey) =>
  typeof part === 'string' && /^[A-Za-z_]+$/.test(part) ? part : '*'
function issueLabel(issue: z.core.$ZodIssue) {
  const path = issue.path.map(maskPart).join('.')
  // 허용 필드를 넓힐지 판단하려면 어떤 키인지 알아야 한다. 키 이름도 같은 마스크를 쓴다.
  return issue.code === 'unrecognized_keys'
    ? `${path}[${issue.keys.map(maskPart).join(',')}]:${issue.code}`
    : `${path}:${issue.code}`
}

export type ReviewItem = {
  kind: 'posting' | 'template'
  id: string
  contentHash: string
  hits: ContactHits
  texts: ReturnType<typeof reviewTexts>
}

// 검증용 경로. 실제 경로는 적재 시 대상 Space로 계산한다.
const PLACEHOLDER_SPACE = 'prepare'
const placeholderBind: AssetBinder = async (asset) => ({
  sourceImageKey: asset.ref,
  copiedImagePath: `${PLACEHOLDER_SPACE}/migration/prepare/${asset.sha256}`,
  verified: true,
  sha256: asset.sha256,
  sizeBytes: asset.sizeBytes,
})

export async function prepareOpeningCustomer(
  client: OpeningSourceClient,
  readObject: OpeningObjectReader,
  options: { brandId: string; webOrigin: string; review?: unknown }
) {
  const review =
    options.review === undefined ? undefined : parseReviewFile(options.review, options.brandId)
  const source = await readOpeningSource(client, options.brandId)
  return buildCustomerPackets(source, readObject, options.webOrigin, review)
}

async function buildCustomerPackets(
  source: OpeningSource,
  readObject: OpeningObjectReader,
  webOrigin: string,
  review?: ReviewApprovals
) {
  const { snapshotAt, brand } = source
  const sourceSnapshotAt = new Date(snapshotAt).toISOString()
  const reasonCounts: Record<string, number> = {}
  const warningCounts: Record<string, number> = {}
  const count = (bucket: Record<string, number>, code: string) => {
    bucket[code] = (bucket[code] ?? 0) + 1
  }
  const hitTotals = { ...emptyHits(), postingsHit: 0, templatesHit: 0 }
  const schemaIssues: Record<string, number> = {}
  const sceneImageDiag: Record<string, number> = {}
  const assetImageDiag: Record<string, number> = {}
  const reviewCounts = { released: 0, stale: 0 }
  const reviewItems: ReviewItem[] = []
  const removed = { managerSections: 0, disabledSections: 0, templateDynamicSections: 0 }
  const assets = new Map<string, Uint8Array>()
  const manualReview = new Map<string, { sha256: string; owners: string[] }>()

  const filesByKey = new Map<string, FileRow[]>()
  for (const file of source.files)
    filesByKey.set(file.file_key, [...(filesByKey.get(file.file_key) ?? []), file])
  const contentById = new Map(source.contents.map((c) => [c.id, c]))

  const webHost = new URL(webOrigin).host
  // Opening은 같은 origin의 /p/ 링크를 지원 링크로 다룬다(복사 공고의 옛 링크 포함).
  const isOpeningPostingUrl = (url: string) => {
    try {
      const parsed = new URL(url)
      return parsed.origin === new URL(webOrigin).origin && parsed.pathname.startsWith('/p/')
    } catch {
      return false
    }
  }

  const objects = new Map<string, Promise<Uint8Array>>()
  async function readFile(key: string, targetTypes: string[], owned = false, allowShared = true) {
    const candidates = filesByKey.get(key) ?? []
    if (candidates.length !== 1) throw Error('ASSET_FILE_MISSING')
    const [file] = candidates
    if (
      file.status !== 1 ||
      !targetTypes.includes(file.target_type) ||
      file.storage_type !== 's3' ||
      !file.storage
    )
      throw Error('ASSET_FILE_REJECTED')
    // 섹션이 직접 가리키는 키는 다른 고객 파일일 수 있어 소유를 확인한다.
    if (owned && file.owner_brand_id !== brand.id && !(allowShared && source.sharedKeys.has(key)))
      throw Error(file.owner_brand_id ? 'ASSET_SCOPE_MISMATCH' : 'ASSET_SCOPE_UNKNOWN')
    if (!objects.has(key)) objects.set(key, readObject({ bucket: file.storage, key }))
    return (objects.get(key) as Promise<Uint8Array>).catch(() => {
      throw Error('ASSET_READ_FAILED')
    })
  }
  const stripped = new Map<string, Promise<Asset>>()
  // design: 디자인 블록의 내보낸 이미지 — 편집기 저장 한도에 맞춰 JPEG로 압축한다.
  async function readAsset(
    key: unknown,
    targetTypes: string[],
    owned = false,
    design = false
  ): Promise<Asset> {
    if (typeof key !== 'string' || !key) throw Error('ASSET_KEY_MISSING')
    const raw = await readFile(key, targetTypes, owned)
    const cacheKey = design ? `${key}\u0000design` : key
    if (!stripped.has(cacheKey))
      stripped.set(
        cacheKey,
        (async () => {
          // 메타데이터를 지운 결과를 해시한다. 검토·복사 대상은 이 바이트다.
          const sniffed = sniffLabel(raw)
          const cleaned = await cleanImage(raw).catch((error) => {
            count(assetImageDiag, imageDiagKey('', sniffed, failureLabel(error)))
            throw error
          })
          const clean = design ? await lossyCompress(cleaned, 'jpeg') : cleaned
          count(assetImageDiag, imageDiagKey('', sniffed, sniffed === 'svg' ? 'CONVERTED' : 'OK'))
          const { bytes, mimeType } = clean
          if (bytes.byteLength > 10 * 1024 * 1024) throw Error('ASSET_TOO_LARGE')
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          assets.set(sha256, bytes)
          return { ref: hashKey(key), sha256, sizeBytes: bytes.byteLength, mimeType }
        })()
      )
    return stripped.get(cacheKey) as Promise<Asset>
  }
  async function readScene(key: string) {
    let scene: Row
    try {
      scene = JSON.parse(
        Buffer.from(await readFile(key, ['content_data'], true, false)).toString('utf8')
      )
    } catch (error) {
      if (reasonOf(error).startsWith('ASSET_')) throw error
      throw Error('SCENE_INVALID')
    }
    return (await sanitizeScene(scene, (key) => count(sceneImageDiag, key))) as Resource['scene']
  }
  function parseCandidate<S extends z.ZodType>(
    schema: S,
    candidate: unknown,
    label: string
  ): z.output<S> {
    const parsed = schema.safeParse(candidate)
    if (parsed.success) return parsed.data
    for (const issue of parsed.error.issues) count(schemaIssues, `${label}:${issueLabel(issue)}`)
    throw Error('PACKET_SCHEMA_REJECTED')
  }
  // 매장·직무 하나의 문제로 고객 전체를 멈추지 않고 그 항목만 보류한다. 형식 오류는 항상 집계한다.
  // 이름은 직무명("인사 담당자")일 수 있고 해제 경로가 없어 키워드는 보지 않는다.
  function orgHoldReason(
    schema: z.ZodType,
    entry: unknown,
    label: string,
    reasons: Record<string, number>
  ) {
    const hits = scanContacts(entry)
    let reason = hits.url ? 'SENSITIVE_URL' : hits.phone + hits.email ? 'CONTACT_PATTERN' : ''
    try {
      parseCandidate(schema, entry, label)
    } catch {
      reason ||= 'FORMAT'
    }
    if (reason) count(reasons, reason)
    return reason
  }
  // 연락처 적중을 승인과 맞춰 본다. 승인이 없거나 내용이 바뀌었으면 검토 대기로 보류한다.
  function gateContacts(
    kind: ReviewItem['kind'],
    entry: ManifestEntry,
    packet: { sourceSnapshotAt: string },
    images: string[]
  ) {
    if (entry.contactHits.url) throw Error('HELD_SENSITIVE_URL')
    if (!contactCount(entry.contactHits)) return
    const contentHash = reviewHash(packet)
    const approved = review?.items.get(`${kind}:${entry.id}`)
    if (approved === contentHash) {
      entry.released = true
      reviewCounts.released++
      return
    }
    if (approved) {
      reviewCounts.stale++
      entry.warnings.push('REVIEW_STALE')
    }
    reviewItems.push({
      kind,
      id: entry.id,
      contentHash,
      hits: entry.contactHits,
      texts: reviewTexts(packet),
    })
    noteImages(`${kind}:${entry.id}`, images)
    throw Error('HELD_CONTACT_PATTERN')
  }

  // 원본 섹션을 허용 필드만 남겨 다시 만든다. 비활성·manager 섹션은 싣지 않는다.
  async function sanitizeSections(
    raw: unknown,
    kind: 'posting' | 'template',
    dynamic: {
      title?: string
      intro?: string
      stores?: string
      positions?: boolean
      applyUrl?: string
    } = {}
  ) {
    if (!Array.isArray(raw)) throw Error('CONTENT_INVALID_DETAIL')
    const detail: Section[] = []
    const resources: Record<string, Resource> = {}
    const images: Record<string, Asset> = {}
    for (const section of raw as Row[]) {
      if (section === null || typeof section !== 'object') throw Error('CONTENT_INVALID_SECTION')
      if (section.type === 'manager') {
        removed.managerSections++
        continue
      }
      if (section.enabled !== true) {
        removed.disabledSections++
        continue
      }
      if (Object.keys(section).some((key) => !SECTION_ATTRIBUTES.has(key)))
        throw Error('CONTENT_UNSUPPORTED_ATTRIBUTE')
      const type = String(section.type)
      const base = {
        enabled: true as const,
        ...(typeof section.name === 'string' ? { name: section.name } : {}),
      }
      const dynamicText: Record<string, string | undefined> = {
        posting_title: dynamic.title,
        company_intro: dynamic.intro,
        posting_stores: dynamic.stores,
      }
      if (type === 'posting_title' || type === 'company_intro' || type === 'posting_stores') {
        if (kind === 'template') {
          removed.templateDynamicSections++
        } else if (dynamicText[type]) detail.push({ ...base, type })
        continue
      }
      if (type === 'posting_positions') {
        if (kind === 'template') removed.templateDynamicSections++
        else if (dynamic.positions) detail.push({ ...base, type })
        continue
      }
      if (type === 'custom') {
        if (kind === 'template') throw Error('TEMPLATE_UNSUPPORTED_SECTION')
        if (!Array.isArray(section.items)) throw Error('CONTENT_INVALID_SECTION')
        if ((section.items as Row[]).some((item) => Object.keys(item ?? {}).length > 2))
          throw Error('CONTENT_UNSUPPORTED_ATTRIBUTE')
        const items = (section.items as Row[]).map((item) => ({
          label: String(item?.label ?? ''),
          value: String(item?.value ?? ''),
        }))
        detail.push({ ...base, type, items })
        continue
      }
      const imageSlot = `index:${detail.length}`
      if (type === 'image') {
        const asset = await readAsset(section.image_key, POSTING_IMAGE_TARGETS, true)
        images[imageSlot] = asset
        detail.push({ ...base, type, image_key: asset.ref })
        continue
      }
      if (type !== 'content' && type !== 'content_link') throw Error('CONTENT_UNSUPPORTED_SECTION')
      const id = String(section.resource_id ?? '')
      const row = contentById.get(id)
      if (!row) throw Error('CONTENT_MISSING_RESOURCE')
      if (row.status !== 1 || row.content_type !== 'excalidraw') throw Error('RESOURCE_UNSUPPORTED')
      if (row.owner_brand_id !== brand.id) throw Error('RESOURCE_SCOPE_MISMATCH')
      const asset = await readAsset(row.image_key, ['content_image'], true, true)
      const sceneKey = text(row.file_key)
      if (type === 'content' && !sceneKey) throw Error('CONTENT_MISSING_SCENE')
      resources[id] = {
        ...asset,
        hasSceneSource: !!sceneKey,
        ...(sceneKey ? { scene: await readScene(sceneKey) } : {}),
      }
      const next: Section = {
        ...base,
        type,
        resource_id: id,
        ...(typeof section.url === 'string'
          ? {
              url:
                dynamic.applyUrl && isOpeningPostingUrl(section.url)
                  ? dynamic.applyUrl
                  : section.url,
            }
          : {}),
      }
      // 원본 HTML은 섹션 이미지, 편집기는 resource scene을 쓰므로 다르면 둘 다 보존한다.
      if (section.image_key && section.image_key !== row.image_key) {
        const original = await readAsset(section.image_key, POSTING_IMAGE_TARGETS, true)
        images[imageSlot] = original
        next.image_key = original.ref
      } else next.image_key = asset.ref
      detail.push(next)
    }
    return { detail, resources, images }
  }

  function noteImages(owner: string, images: string[]) {
    for (const sha256 of images) {
      const known = manualReview.get(sha256) ?? { sha256, owners: [] }
      if (!known.owners.includes(owner)) known.owners.push(owner)
      manualReview.set(sha256, known)
    }
  }

  // 조직 기준정보. 비활성은 대상 공고가 참조할 때만 읽혔다.
  const heldOrg = { stores: [] as string[], positions: [] as string[] }
  const orgReasons = {
    stores: {} as Record<string, number>,
    positions: {} as Record<string, number>,
  }
  const stores: OrgPacket['stores'] = []
  const storeText = new Map<string, string>()
  for (const row of source.stores) {
    const roadAddress = text(row.original_addr1) || text(row.original_address)
    const detailAddress = text(row.original_addr1) ? text(row.original_addr2) : ''
    const zipcode = text(row.zipcode)
    const entry = {
      sourceId: String(row.id),
      name: text(row.name),
      ...(roadAddress ? { roadAddress } : {}),
      ...(detailAddress ? { detailAddress } : {}),
      ...(zipcode ? { zipcode } : {}),
      isActive: row.status === 1,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
    if (orgHoldReason(orgPacketSchema.shape.stores.element, entry, 'store', orgReasons.stores)) {
      heldOrg.stores.push(entry.sourceId)
      continue
    }
    stores.push(entry)
    storeText.set(
      entry.sourceId,
      [`${brand.name} ${entry.name}`.trim(), [roadAddress, detailAddress].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join('\n')
    )
  }
  const positions: OrgPacket['positions'] = []
  for (const row of source.positions) {
    const category = text(row.category_name)
    const entry = {
      sourceId: String(row.id),
      name: text(row.name),
      ...(category ? { category } : {}),
      isActive: row.status === 1,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
    if (
      orgHoldReason(
        orgPacketSchema.shape.positions.element,
        entry,
        'position',
        orgReasons.positions
      )
    )
      heldOrg.positions.push(entry.sourceId)
    else positions.push(entry)
  }
  const org = orgPacketSchema.parse({
    sourceSpaceId: brand.id,
    sourceSnapshotAt,
    stores,
    positions,
  })

  const addHits = (hits: ContactHits, bucket: 'postingsHit' | 'templatesHit') => {
    hitTotals.phone += hits.phone
    hitTotals.email += hits.email
    hitTotals.keyword += hits.keyword
    hitTotals.url += hits.url
    if (contactCount(hits) + hits.url) hitTotals[bucket]++
  }
  const usedImages = (
    content: Pick<PostingPacket['content'], 'resources' | 'images'>,
    extra?: Asset
  ) => [
    ...new Set(
      [
        ...Object.values(content.resources),
        ...Object.values(content.images),
        ...(extra ? [extra] : []),
      ].map((asset) => asset.sha256)
    ),
  ]
  const postingEntries: ManifestEntry[] = []
  const postingPackets: PostingPacket[] = []
  const bodies = new Map(source.postings.map((row) => [String(row.id), row]))
  const updatedOnlyDates: string[] = []
  const windowStart = migrationWindowStart(new Date(snapshotAt)).getTime()

  for (const row of source.overview) {
    const entry = newEntry(row.id, 'excluded')
    postingEntries.push(entry)
    const body = bodies.get(row.id)
    if (!body) {
      entry.reasons.push(row.status === 0 ? 'DELETED' : 'OUT_OF_WINDOW')
      count(reasonCounts, entry.reasons[0])
      continue
    }
    // 제목 없는 작성 중 공고는 옮길 내용이 없다.
    if (!text(body.title)) {
      entry.reasons.push('NO_TITLE')
      count(reasonCounts, 'NO_TITLE')
      continue
    }
    if (new Date(row.created_at).getTime() < windowStart)
      updatedOnlyDates.push(kstDate(row.updated_at))
    try {
      const warn = (code: string) => {
        if (!entry.warnings.includes(code)) entry.warnings.push(code)
        count(warningCounts, code)
      }
      const linkedStores = source.postingStores
        .filter((link) => link.posting_id === row.id)
        .map((link) => link.store_id)
        .sort()
      if (linkedStores.some((id) => !storeText.has(id))) throw Error('STORE_UNAVAILABLE')
      const positionRows = source.postingPositions.filter((p) => p.posting_id === row.id)
      if (positionRows.some((p) => !org.positions.some((o) => o.sourceId === p.position_id)))
        throw Error('POSITION_UNAVAILABLE')
      const mapped = positionRows.map((position) => mapPosition(position, warn))
      const storesText = linkedStores.map((id) => storeText.get(id)).join('\n\n')
      const positionNotes = mapped.flatMap((item) => (item.note ? [item.note] : [])).join('\n')
      const title = text(body.posting_title)
      const intro = text(body.company_intro)
      const applyUrl = `${webOrigin}/p/${text(body.uuid)}`
      const content = await sanitizeSections(body.detail, 'posting', {
        title,
        intro,
        stores: storesText,
        positions: mapped.length > 0,
        applyUrl,
      })
      const detailImageKey = text(body.detail_image_key)
      const detailImage = detailImageKey
        ? await readAsset(detailImageKey, ['posting_detail_img'], true)
        : undefined
      const form = planOpeningForm(`opening.work:posting:${row.id}`, body.application_entries, {
        preserveRepeatedCustomFields: true,
      })
      if (!form.ok) throw Error(`FORM_${form.code}`)
      const candidate = {
        sourceSpaceId: brand.id,
        sourcePostingId: row.id,
        sourceSnapshotAt,
        posting: {
          uuid: text(body.uuid),
          title: text(body.title),
          status: row.status,
          createdAt: iso(row.created_at),
          updatedAt: iso(row.updated_at),
          closingDate: body.closing_date ? iso(body.closing_date) : null,
          applicationEntries: formDefinition(body.application_entries),
        },
        positions: mapped.map((item) => item.position),
        sourceStoreIds: linkedStores,
        historicalStoreIds: linkedStores.filter(
          (id) => !org.stores.some((store) => store.sourceId === id && store.isActive)
        ),
        content: {
          ...content,
          ...(detailImage ? { detailImage } : {}),
          ...(title ? { postingTitle: title } : {}),
          ...(intro ? { companyIntro: intro } : {}),
          positionsVerified: mapped.length > 0,
          ...(positionNotes ? { positionConditionsText: positionNotes } : {}),
          ...(storesText ? { storesText } : {}),
          originalApplyUrl: applyUrl,
        },
      }
      // 본문 글자·scene 링크의 opening 주소는 12/18에 끊긴다. 자동 치환하지 않고 건수만 알린다.
      if (JSON.stringify(candidate.content).replaceAll(applyUrl, '').includes(webHost))
        warn('OPENING_URL_REMAINS')
      entry.contactHits = scanContacts(candidate)
      addHits(entry.contactHits, 'postingsHit')
      const packet = parseCandidate(postingPacketSchema, candidate, 'posting')
      const embedded = embeddedImages(packet.content)
      for (const image of embedded) assets.set(image.sha256, image.bytes)
      if (embedded.some((image) => !review?.images.has(image.sha256))) {
        noteImages(`posting:${row.id}`, [
          ...unreadImages(packet.content, [packet.content.detailImage]),
          ...embedded.map((image) => image.sha256),
        ])
        throw Error('EMBEDDED_IMAGE_REVIEW_REQUIRED')
      }
      const images = [
        ...unreadImages(packet.content, [packet.content.detailImage]),
        ...embedded.map((image) => image.sha256),
      ]
      gateContacts('posting', entry, packet, images)
      // 적재기와 같은 계획기로 미리 통과시켜 적재 단계에서 막힐 공고를 여기서 보류한다.
      await planPosting(packet, PLACEHOLDER_SPACE, placeholderBind, review)
      entry.status = 'included'
      entry.imageSha256 = usedImages(packet.content, packet.content.detailImage)
      noteImages(`posting:${row.id}`, images)
      postingPackets.push(packet)
    } catch (error) {
      entry.status = 'held'
      const reason = reasonOf(error)
      entry.reasons.push(reason)
      count(reasonCounts, reason)
    }
  }

  const templateEntries: ManifestEntry[] = []
  const templatePackets: TemplatePacket[] = []
  const templateReasons: Record<string, number> = {}
  for (const row of source.templates) {
    const id = String(row.id)
    const entry = newEntry(id, 'held')
    templateEntries.push(entry)
    try {
      const content = await sanitizeSections(row.data, 'template')
      const cover = text(row.image_key)
        ? await readAsset(row.image_key, POSTING_IMAGE_TARGETS, true)
        : undefined
      const candidate = {
        sourceSpaceId: brand.id,
        sourceTemplateId: id,
        sourceSnapshotAt,
        sourceWebOrigin: webOrigin,
        name: text(row.name),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        ...(cover ? { cover } : {}),
        ...content,
      }
      entry.contactHits = scanContacts(candidate)
      addHits(entry.contactHits, 'templatesHit')
      const packet = parseCandidate(templatePacketSchema, candidate, 'template')
      const embedded = embeddedImages(packet)
      for (const image of embedded) assets.set(image.sha256, image.bytes)
      if (embedded.some((image) => !review?.images.has(image.sha256))) {
        noteImages(`template:${id}`, [
          ...unreadImages(packet, [packet.cover]),
          ...embedded.map((image) => image.sha256),
        ])
        throw Error('EMBEDDED_IMAGE_REVIEW_REQUIRED')
      }
      const images = [
        ...unreadImages(packet, [packet.cover]),
        ...embedded.map((image) => image.sha256),
      ]
      gateContacts('template', entry, packet, images)
      await planTemplate(packet, PLACEHOLDER_SPACE, PLACEHOLDER_SPACE, placeholderBind, review)
      entry.status = 'included'
      entry.imageSha256 = usedImages(packet, packet.cover)
      noteImages(`template:${id}`, images)
      templatePackets.push(packet)
    } catch (error) {
      const reason = reasonOf(error)
      entry.reasons.push(reason)
      count(templateReasons, reason)
    }
  }

  const statusCount = (entries: ManifestEntry[], status: ManifestEntry['status']) =>
    entries.filter((entry) => entry.status === status).length
  // 보류·제외 항목의 이미지는 읽었더라도 packet 폴더에 남기지 않는다.
  const keptImages = new Set(
    [...postingEntries, ...templateEntries].flatMap((entry) => entry.imageSha256)
  )
  const keptAssets = new Map([...assets].filter(([sha256]) => keptImages.has(sha256)))
  const pendingImages = [...manualReview.values()].filter(
    (image) => !review?.images.has(image.sha256)
  )
  const updatedOnlyByDate: Record<string, number> = {}
  for (const date of updatedOnlyDates.sort()) count(updatedOnlyByDate, date)
  const summary = {
    sourceSpaceId: brand.id,
    snapshotAt: sourceSnapshotAt,
    windowStart: new Date(windowStart).toISOString(),
    postings: {
      total: postingEntries.length,
      included: statusCount(postingEntries, 'included'),
      held: statusCount(postingEntries, 'held'),
      excluded: statusCount(postingEntries, 'excluded'),
      reasons: reasonCounts,
      warnings: warningCounts,
    },
    updatedOnly: { count: updatedOnlyDates.length, byDate: updatedOnlyByDate },
    contactHits: hitTotals,
    images: {
      total: keptAssets.size,
      manualReview: manualReview.size,
      pendingReview: pendingImages.length,
    },
    schemaIssues,
    sceneImageDiag,
    assetImageDiag,
    review: { ...reviewCounts, pendingItems: reviewItems.length },
    templates: {
      total: templateEntries.length,
      included: statusCount(templateEntries, 'included'),
      held: statusCount(templateEntries, 'held'),
      reasons: templateReasons,
    },
    stores: {
      active: org.stores.filter((s) => s.isActive).length,
      historical: org.stores.filter((s) => !s.isActive).length,
      held: heldOrg.stores.length,
      heldReasons: orgReasons.stores,
    },
    positions: {
      active: org.positions.filter((p) => p.isActive).length,
      historical: org.positions.filter((p) => !p.isActive).length,
      held: heldOrg.positions.length,
      heldReasons: orgReasons.positions,
    },
    removedSections: removed,
  }
  const manifest = {
    summary,
    postings: postingEntries,
    templates: templateEntries,
    stores: org.stores.map((store) => store.sourceId),
    positions: org.positions.map((position) => position.sourceId),
    heldOrg,
    manualReviewImages: [...manualReview.values()],
    review: review ? { reviewer: review.reviewer, reviewedAt: review.reviewedAt } : null,
  }
  return {
    summary,
    manifest,
    org,
    templates: templatePackets,
    postings: postingPackets,
    assets: keptAssets,
    review: {
      sourceSpaceId: brand.id,
      items: reviewItems,
      images: pendingImages.flatMap((image) => {
        const bytes = assets.get(image.sha256)
        return bytes ? [{ ...image, bytes }] : []
      }),
    },
  }
}
export type PreparedCustomer = Awaited<ReturnType<typeof prepareOpeningCustomer>>

// 고객 자료가 저장소에 섞이지 않게, 지난 실행 결과가 섞이지 않게 저장소 밖 빈 폴더만 받는다.
export function assertOutDir(out: string, repoRoot: string) {
  const root = resolve(out)
  if (root === repoRoot || root.startsWith(repoRoot + sep)) throw Error('OUT_DIR_INSIDE_REPO')
  if (existsSync(root) && readdirSync(root).length) throw Error('OUT_DIR_NOT_EMPTY')
  return root
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// 원문·연락처가 들어 있는 폴더라 소유자만 읽게 쓰고, 다 쓴 뒤 지우는 것은 운영자 몫이다.
export function writeReviewDir(root: string, review: PreparedCustomer['review']) {
  for (const dir of [root, join(root, 'items'), join(root, 'images')]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
  }
  const write = (path: string, data: string | Uint8Array) => {
    writeFileSync(join(root, path), data, { mode: 0o600 })
    chmodSync(join(root, path), 0o600)
  }
  write(
    'candidates.json',
    JSON.stringify(
      {
        sourceSpaceId: review.sourceSpaceId,
        items: review.items.map(({ kind, id, contentHash, hits }) => ({
          kind,
          id,
          contentHash,
          hits,
        })),
        images: review.images.map(({ sha256, owners }) => ({ sha256, owners })),
      },
      null,
      2
    )
  )
  for (const item of review.items)
    write(`items/${item.kind}-${item.id}.json`, JSON.stringify(item, null, 2))
  for (const image of review.images)
    write(
      `images/${image.sha256}.${IMAGE_EXTENSIONS[sniffImage(image.bytes) ?? ''] ?? 'bin'}`,
      image.bytes
    )
}
