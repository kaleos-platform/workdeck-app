/** @jest-environment node */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { HiringMigrationRecord } from '@/generated/prisma/client'
import { decodeMigrationSnapshot, migrationSourceRef } from '../ledger'
import {
  assertImportTarget,
  planPosting,
  planTemplate,
  safeMigrationSummary,
  safeMigrationStatus,
  runOpeningImport,
  writeImportIssues,
  type TargetStorage,
} from '../opening-import'
import {
  isInMigrationWindow,
  embeddedImages,
  migrationWindowStart,
  parseReviewFile,
  postingPacketSchema,
  reviewHash,
  reviewTexts,
  scanContacts,
  type PostingPacket,
} from '../opening-packet'
import { cleanImage, sanitizeScene, stripImageMetadata } from '../opening-sanitize'
import {
  assertOutDir,
  prepareOpeningCustomer,
  writeReviewDir,
  type OpeningObjectReader,
  type OpeningSourceClient,
} from '../opening-prepare'

function crc32(data: Buffer) {
  let crc = ~0
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return ~crc >>> 0
}

it('stdout 상태는 정해진 상태만 보존한다', () => {
  expect(safeMigrationStatus('PLANNED')).toBe('PLANNED')
  expect(safeMigrationStatus('CONFLICT_STOPPED')).toBe('CONFLICT_STOPPED')
  expect(safeMigrationStatus('APPLIED_PARTIAL')).toBe('APPLIED_PARTIAL')
  expect(safeMigrationStatus('APPLIED')).toBe('APPLIED')
  expect(safeMigrationStatus('privateperson')).toBe('UNKNOWN')
})

it('자산 소유권 불일치와 미확인을 stdout에서 구분한다', () => {
  expect(
    safeMigrationSummary({
      postings: { reasons: { ASSET_SCOPE_MISMATCH: 1, ASSET_SCOPE_UNKNOWN: 2 } },
    })
  ).toMatchObject({ postings: { reasons: { ASSET_SCOPE_MISMATCH: 1, ASSET_SCOPE_UNKNOWN: 2 } } })
})

it('stdout은 고정 사유와 경고만 출력하고 나머지는 OTHER로 합산한다', () => {
  const result = safeMigrationSummary({
    postings: {
      reasons: { EMBEDDED_IMAGE_REVIEW_REQUIRED: 2, PRIVATE_NAME: 3, OTHER_PRIVATE: 4 },
      warnings: { OPENING_URL_REMAINS: 1, PRIVATE_WARNING: 2 },
    },
    templates: { reasons: { HELD_CONTACT_PATTERN: 2, PRIVATE_NAME: 1 } },
    stores: { heldReasons: { FORMAT: 1, PRIVATE_NAME: 2 } },
    positions: { heldReasons: { CONTACT_PATTERN: 1 } },
  })
  expect(result.postings).toMatchObject({
    reasons: { EMBEDDED_IMAGE_REVIEW_REQUIRED: 2, OTHER: 7 },
    warnings: { OPENING_URL_REMAINS: 1, OTHER: 2 },
  })
  expect(result.templates).toMatchObject({ reasons: { HELD_CONTACT_PATTERN: 2, OTHER: 1 } })
  expect(result.stores).toMatchObject({ heldReasons: { FORMAT: 1, OTHER: 2 } })
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_NAME|OTHER_PRIVATE|PRIVATE_WARNING/)
})

it('stdout 사유 합계가 안전 정수 범위를 넘으면 중단한다', () => {
  expect(() =>
    safeMigrationSummary({ postings: { reasons: { A: Number.MAX_SAFE_INTEGER, B: 1 } } })
  ).toThrow('SUMMARY_COUNT_OVERFLOW')
  expect(() =>
    safeMigrationSummary({ postings: { reasons: { A: Number.MAX_SAFE_INTEGER + 1 } } })
  ).toThrow('SUMMARY_COUNT_OVERFLOW')
})

it('stdout 사유는 상속 키와 잘못된 숫자를 집계하지 않는다', () => {
  const reasons = Object.assign(Object.create({ PRIVATE_INHERITED: 8 }), {
    EMBEDDED_IMAGE_REVIEW_REQUIRED: 1,
    PRIVATE_NEGATIVE: -1,
    PRIVATE_FRACTION: 1.5,
    PRIVATE_INFINITY: Infinity,
  })
  const result = safeMigrationSummary({ postings: { reasons } })
  expect(result.postings.reasons).toEqual({ EMBEDDED_IMAGE_REVIEW_REQUIRED: 1 })
})

const snapshotAt = new Date('2026-10-31T03:00:00.000Z')
const recent = new Date('2026-09-01T00:00:00.000Z')
const old = new Date('2024-01-01T00:00:00.000Z')
const solid = (seed: number) =>
  sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: seed, g: 10, b: 20 } },
  })
const png = async (seed: number) => new Uint8Array(await solid(seed).png().toBuffer())
let embeddedPng = ''
beforeAll(async () => {
  embeddedPng = `data:image/png;base64,${Buffer.from(await png(1)).toString('base64')}`
})

const form = [
  { key: 'name', type: 'string', label: '이름', required: true },
  { key: 'phone', type: 'phone', label: '연락처', required: true },
]
const scene = (text = '합성 안내') => ({
  type: 'excalidraw',
  version: 2,
  elements: [
    { id: 'a', type: 'text', text },
    { id: 'i', type: 'image', fileId: 'f' },
    { id: 'd', type: 'text', text: '지운 글자 hr-old@synthetic.test', isDeleted: true },
  ],
  appState: { viewBackgroundColor: '#ffffff', collaborators: [{ name: '합성 편집자' }] },
  files: {
    f: { id: 'f', mimeType: 'image/png', dataURL: embeddedPng, lastRetrieved: 1 },
    orphan: { id: 'orphan', mimeType: 'image/png', dataURL: embeddedPng },
  },
})
const textScene = (text = '합성 안내') => ({
  type: 'excalidraw',
  version: 2,
  elements: [{ id: 'a', type: 'text', text }],
  files: {},
})
const body = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  uuid: `pub${id}`,
  status: 1,
  title: `합성 공고 ${id}`,
  created_at: recent,
  updated_at: recent,
  closing_date: null,
  posting_title: '합성 제목',
  company_intro: '합성 회사 소개',
  detail_image_key: '',
  application_entries: form,
  detail: [
    { type: 'posting_title', enabled: true },
    { type: 'manager', enabled: true },
    { type: 'posting_positions', enabled: true },
    { type: 'posting_stores', enabled: true },
    { type: 'content', enabled: true, resource_id: 70, image_url: 'https://signed.example/x' },
    { type: 'image', enabled: true, image_key: 'posting_detail/u/사람이름.png' },
    {
      type: 'custom',
      enabled: false,
      items: [{ label: '비활성', value: '비활성 010-9999-8888' }],
    },
  ],
  ...overrides,
})

function sourceRows(extra: Record<string, unknown[]> = {}) {
  const postings = [
    body('1'),
    body('2', { created_at: old, updated_at: new Date('2026-03-02T01:00:00.000Z') }),
    body('5', {
      detail: [
        { type: 'custom', enabled: true, items: [{ label: '문의', value: '연락 010-1234-5678' }] },
      ],
    }),
    body('6', {
      detail: [{ type: 'content', enabled: true, resource_id: 71 }],
    }),
    body('7', {
      detail: [{ type: 'custom', enabled: true, items: [], surprise: 'x' }],
    }),
  ]
  return {
    overview: [
      ...postings.map(({ id, status, created_at, updated_at }) => ({
        id,
        status,
        created_at,
        updated_at,
      })),
      { id: '3', status: 1, created_at: old, updated_at: old },
      { id: '4', status: 0, created_at: recent, updated_at: recent },
    ],
    postings,
    postingPositions: postings.map((posting, index) => ({
      id: String(100 + index),
      posting_id: posting.id,
      position_id: '30',
      name: '합성 직무',
      job_type: 'recruiting',
      job_experience: 'no_exp',
      pay_frequency: 'hourly',
      pay_amount: 10000,
      fixed_work_schedule_type: 'mon_to_fri',
      work_days: [],
      work_start_time: '09:00',
      work_end_time: '18:00',
      intake: 2,
      unknown_intake: false,
      contract_months: 3,
      education: 'all',
      created_at: recent,
      updated_at: recent,
    })),
    postingStores: postings.flatMap((posting) => [
      { posting_id: posting.id, store_id: '20' },
      { posting_id: posting.id, store_id: '21' },
    ]),
    stores: [
      {
        id: '20',
        status: 1,
        name: '합성 매장',
        original_addr1: '서울 합성로 1',
        original_addr2: '2층',
        zipcode: '00000',
        created_at: recent,
        updated_at: recent,
      },
      {
        id: '21',
        status: 0,
        name: '폐점 매장',
        original_address: '서울 합성로 2',
        created_at: recent,
        updated_at: recent,
      },
    ],
    positions: [
      {
        id: '30',
        status: 1,
        name: '합성 직무',
        category_name: '서비스',
        created_at: recent,
        updated_at: recent,
      },
    ],
    templates: [
      {
        id: '40',
        name: '합성 템플릿',
        image_key: 'posting_detail/u/cover.png',
        data: [
          { type: 'manager', enabled: true },
          { type: 'posting_title', enabled: true },
          { type: 'content', enabled: true, resource_id: 72 },
        ],
        created_at: recent,
        updated_at: recent,
      },
    ],
    contents: [
      contentRow('70', 'content_image/a.png', 'content_data/a.json'),
      contentRow('71', 'content_image/b.png', 'content_data/b.json'),
      contentRow('72', 'content_image/c.png', 'content_data/c.json'),
    ],
    files: [
      file('posting_detail/u/사람이름.png', 'posting_detail'),
      file('posting_detail/u/cover.png', 'posting_detail'),
      ...['a', 'b', 'c'].flatMap((name) => [
        file(`content_image/${name}.png`, 'content_image'),
        file(`content_data/${name}.json`, 'content_data'),
      ]),
    ],
    sampleTemplates: [] as unknown[],
    sampleContents: [] as unknown[],
    ...extra,
  }
}
function contentRow(id: string, image_key: string, file_key: string) {
  return {
    id,
    status: 1,
    content_type: 'excalidraw',
    image_key,
    file_key,
    owner_brand_id: '9',
  }
}
function file(file_key: string, target_type: string) {
  return {
    file_key,
    status: 1,
    target_type,
    storage_type: 's3',
    storage: 'bucket',
    owner_brand_id: '9' as string | null,
  }
}

function fakeSource(rows = sourceRows()) {
  const queries: string[] = []
  const client: OpeningSourceClient = {
    query: async (sql) => {
      queries.push(sql)
      const table: [RegExp, unknown[]][] = [
        [/FROM file/, rows.files],
        [/FROM setting/, [{ setting_value: '[500]' }]],
        [/SELECT id::text, status, image_key, data FROM detail_template/, rows.sampleTemplates],
        [/SELECT id::text, source_id::text, status, image_key FROM content/, rows.sampleContents],
        [/now\(\)/, [{ snapshot_at: snapshotAt }]],
        [/FROM brand/, [{ id: '9', name: '합성브랜드' }]],
        [/status, created_at, updated_at FROM posting/, rows.overview],
        [/FROM posting WHERE id/, rows.postings],
        [/FROM posting_position/, rows.postingPositions],
        [/FROM posting_store/, rows.postingStores],
        [/FROM store/, rows.stores],
        [/FROM position/, rows.positions],
        [/FROM detail_template WHERE|FROM detail_template\s+WHERE/, rows.templates],
        [/FROM content/, rows.contents],
      ]
      return { rows: table.find(([pattern]) => pattern.test(sql))?.[1] ?? [] }
    },
  }
  return { client, queries }
}
const readObject: OpeningObjectReader = async ({ key }) => {
  if (key === 'content_data/a.json') return Buffer.from(JSON.stringify(textScene()))
  if (key === 'content_data/b.json')
    return Buffer.from(JSON.stringify(textScene('담당 010-1234-5678 / hr@synthetic.test')))
  if (key === 'content_data/c.json') return Buffer.from(JSON.stringify(textScene()))
  return png([...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 200)
}
const prepare = (rows = sourceRows(), review?: unknown) =>
  prepareOpeningCustomer(fakeSource(rows).client, readObject, {
    brandId: '9',
    webOrigin: 'https://opening.work',
    review,
  })
const reviewFile = (overrides: Record<string, unknown> = {}) => ({
  sourceSpaceId: '9',
  reviewer: '합성 검토자',
  reviewedAt: '2026-11-01',
  items: [] as unknown[],
  images: [] as string[],
  ...overrides,
})

type Row = { id: string; spaceId: string; [key: string]: unknown }
function fakeDb() {
  let sequence = 0
  const id = () => `id${++sequence}`
  const records = new Map<string, Row>()
  // 실제 DB처럼 비어 있는 선택 컬럼을 null로 돌려준다.
  const table = (rows: Map<string, Row>, nullable: string[] = []) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const nulls = Object.fromEntries(nullable.map((key) => [key, null]))
      const row = { ...nulls, ...JSON.parse(JSON.stringify(data)), id: id() } as Row
      rows.set(row.id, row)
      return row
    },
    findUnique: async ({ where }: { where: { id?: string; uuid?: string; sourceRef?: string } }) =>
      [...rows.values()].find((row) =>
        where.id
          ? row.id === where.id
          : where.uuid
            ? row.uuid === where.uuid
            : row.sourceRef === where.sourceRef
      ) ?? null,
    count: async () => 0,
  })
  const stores = new Map<string, Row>()
  const positions = new Map<string, Row>()
  const postings = new Map<string, Row>()
  const templates = new Map<string, Row>()
  const nested = (base: ReturnType<typeof table>) => ({
    ...base,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const contents = (data.contents as { create: unknown[] }).create
      return base.create({ data: { ...data, contents } })
    },
  })
  const transactionOptions: unknown[] = []
  const db = {
    $transaction: async (fn: (tx: unknown) => unknown, options?: unknown) => {
      transactionOptions.push(options)
      return fn(db)
    },
    space: { findUnique: async () => ({ id: 'space', name: '합성 고객 공간' }) },
    spaceMember: {
      findFirst: async () => ({ userId: 'owner' }),
      findUnique: async () => ({ role: 'OWNER' }),
    },
    hiringMigrationRecord: {
      findUnique: async ({ where }: { where: { sourceRef: string } }) =>
        records.get(where.sourceRef) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = { ...data, id: id() }
        records.set(data.sourceRef as string, row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = [...records.values()].find((item) => item.id === where.id) as Row
        Object.assign(row, data)
        return row
      },
    },
    hiringStore: table(stores, ['roadAddress', 'detailAddress', 'zipcode']),
    hiringPosition: table(positions, ['category']),
    hiringPosting: nested(table(postings)),
    hiringDetailTemplate: nested(table(templates)),
  }
  return { db, records, stores, positions, postings, templates, transactionOptions }
}
type FakeDb = Parameters<typeof runOpeningImport>[0]

function memoryStorage() {
  const objects = new Map<string, Uint8Array>()
  const storage: TargetStorage = {
    read: async (path) => objects.get(path) ?? null,
    write: async (path, bytes) => void objects.set(path, bytes),
  }
  return { objects, storage }
}

// 기본은 검토자가 이미지를 모두 확인한 상태로 적재한다.
async function importSet(
  db: ReturnType<typeof fakeDb>['db'],
  prepared: Awaited<ReturnType<typeof prepare>>,
  apply: boolean,
  storage = memoryStorage().storage,
  extra: { review?: unknown; skipConflicts?: boolean } = {}
) {
  const images = prepared.manifest.manualReviewImages.map((image) => image.sha256)
  return runOpeningImport(db as unknown as FakeDb, prepared, {
    spaceId: 'space',
    brandId: '9',
    apply,
    storage,
    readAsset: async (sha256) => prepared.assets.get(sha256) as Uint8Array,
    review: reviewFile({ images }),
    ...extra,
  })
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
  process.env.ENCRYPTION_KEY_V1 = 'd'.repeat(64)
})

describe('기간·연락처 판정', () => {
  it('C는 T의 KST 날짜 기준 12개월 전 00:00이다', () => {
    // UTC로는 10/30이지만 KST로는 10/31이다.
    expect(migrationWindowStart(new Date('2026-10-30T15:30:00.000Z')).toISOString()).toBe(
      '2025-10-30T15:00:00.000Z'
    )
    expect(migrationWindowStart(new Date('2028-02-29T03:00:00.000Z')).toISOString()).toBe(
      '2027-02-27T15:00:00.000Z'
    )
  })

  it('경계 시각은 포함하고 그 직전은 제외한다', () => {
    const start = migrationWindowStart(snapshotAt)
    const before = new Date(start.getTime() - 1)
    expect(isInMigrationWindow({ createdAt: start, updatedAt: start }, snapshotAt)).toBe(true)
    expect(isInMigrationWindow({ createdAt: before, updatedAt: before }, snapshotAt)).toBe(false)
    expect(isInMigrationWindow({ createdAt: before, updatedAt: start }, snapshotAt)).toBe(true)
  })

  it.each([
    ['문의 010-1234-5678', { phone: 1 }],
    ['010 1234 5678', { phone: 1 }],
    ['01012345678', { phone: 1 }],
    ['+82 10-1234-5678', { phone: 1 }],
    ['0507-1234-5678', { phone: 1 }],
    ['02-123-4567', { phone: 1 }],
    ['010–1234–5678', { phone: 1 }],
    ['010/1234/5678', { phone: 1 }],
    ['０１０－１２３４－５６７８', { phone: 1 }],
    ['010 . 1234 . 5678', { phone: 1 }],
    ['hr.team+a@synthetic.co.kr', { email: 1 }],
    ['hr (at) synthetic.co.kr', { email: 1 }],
    ['hr[at]synthetic.co.kr', { email: 1 }],
    ['ｈｒ＠synthetic.co.kr', { email: 1 }],
    ['채용 담당자에게 보내 주세요', { keyword: 1 }],
    ['연락처를 남겨 주세요', { keyword: 1 }],
    ['채용문의', { keyword: 1 }],
    ['오픈채팅방', { keyword: 1 }],
    ['https://open.kakao.com/o/abc', { keyword: 1 }],
    ['https://user:pass@example.test/a', { email: 1, url: 1 }],
    ['https://example.test/a?token=abc', { url: 1 }],
    ['https://example.test/a?X-Amz-Signature=abc', { url: 1 }],
    ['https://example.test/a?utm_source=x', {}],
    ['a'.repeat(4) + '01012345678' + 'b'.repeat(4), {}],
    ['2026-10-31T03:00:00.000Z', {}],
    ['2026.10.31', {}],
    ['시급 10,030원', {}],
  ])('%s', (value, expected) => {
    expect(scanContacts({ nested: [value] })).toEqual({
      phone: 0,
      email: 0,
      keyword: 0,
      url: 0,
      ...expected,
    })
  })

  it('객체 키도 검사한다', () => {
    expect(scanContacts({ '010-1234-5678': 'x' }).phone).toBe(1)
  })

  it('지원서 폼의 표준 문항명은 키워드로 세지 않지만 전화번호는 잡는다', () => {
    expect(scanContacts({ applicationEntries: [{ label: '연락처' }] }).keyword).toBe(0)
    expect(scanContacts({ applicationEntries: [{ label: '010-1234-5678' }] }).phone).toBe(1)
  })

  it('이미지 데이터는 scene.files[*].dataURL만 건너뛴다', () => {
    const dataURL = '010-1234-5678'
    expect(scanContacts({ files: { f: { dataURL } } }).phone).toBe(0)
    expect(scanContacts({ scene: { files: { f: { dataURL } } } }).phone).toBe(0)
    expect(scanContacts({ dataURL }).phone).toBe(1)
    expect(scanContacts({ elements: [{ dataURL }] }).phone).toBe(1)
    expect(scanContacts({ a: { b: { files: { f: { dataURL } } } } }).phone).toBe(1)
  })
})

describe('이미지·scene 정제', () => {
  const metadataOf = (bytes: Uint8Array) => sharp(bytes).metadata()

  it('JPEG의 EXIF·XMP를 지우고 방향은 픽셀에 반영한다', async () => {
    const source = await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: '합성 작성자' }, IFD2: {} })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">synthetic</x:xmpmeta>')
      .toBuffer()
    const rotated = await sharp(source).withMetadata({ orientation: 6 }).toBuffer()
    expect((await metadataOf(rotated)).exif).toBeDefined()
    const clean = await stripImageMetadata(rotated, 'image/jpeg')
    const metadata = await metadataOf(clean)
    expect(metadata).toMatchObject({ width: 2, height: 4 })
    expect(metadata.exif).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
    expect(metadata.orientation).toBeUndefined()
  })

  it('PNG 텍스트 청크를 지운다', async () => {
    const base = Buffer.from(await png(5))
    const body = Buffer.from('Comment\x00' + '010-1234-5678', 'latin1')
    const type = Buffer.from('tEXt', 'latin1')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([type, body])))
    const withText = Buffer.concat([
      base.subarray(0, 33),
      length,
      type,
      body,
      crc,
      base.subarray(33),
    ])
    expect(withText.includes(Buffer.from('010-1234-5678'))).toBe(true)
    const clean = await stripImageMetadata(withText, 'image/png')
    expect(Buffer.from(clean).includes(Buffer.from('010-1234-5678'))).toBe(false)
  })

  it.each([
    ['image/png', () => solid(30).png().toBuffer()],
    ['image/jpeg', () => solid(30).jpeg().toBuffer()],
    ['image/webp', () => solid(30).webp().toBuffer()],
    ['image/gif', () => solid(30).gif().toBuffer()],
  ] as const)('%s 재인코딩 결과는 실행마다 같아 승인 해시가 유지된다', async (mimeType, make) => {
    const bytes = await make()
    const first = await stripImageMetadata(bytes, mimeType)
    const second = await stripImageMetadata(bytes, mimeType)
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
  })

  it('움직이는 GIF의 프레임을 유지한다', async () => {
    const frames = await Promise.all([solid(1).png().toBuffer(), solid(90).png().toBuffer()])
    const gif = await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer()
    const clean = await stripImageMetadata(gif, 'image/gif')
    expect((await sharp(clean, { animated: true }).metadata()).pages).toBe(2)
  })

  it('디코딩할 수 없는 이미지는 고정 코드로 막는다', async () => {
    await expect(
      stripImageMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')
    ).rejects.toThrow('ASSET_UNDECODABLE')
  })

  it('삭제 요소·미사용 파일·customData·편집기 상태를 지운다', async () => {
    const raw = scene()
    Object.assign(raw.elements[0], { customData: { owner: '합성' } })
    const clean = await sanitizeScene(raw)
    expect(clean.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'i'])
    expect(clean.elements[0].customData).toBeUndefined()
    expect(Object.keys(clean.files)).toEqual(['f'])
    expect(clean.files.f.lastRetrieved).toBeUndefined()
    expect(clean.appState).toEqual({ viewBackgroundColor: '#ffffff' })
    expect(JSON.stringify(clean)).not.toMatch(/hr-old|합성 편집자/)
  })

  it('scene 내장 이미지의 메타데이터도 지운다', async () => {
    const exif = await sharp(await png(7))
      .withExif({ IFD0: { Copyright: '합성 작성자' } })
      .toBuffer()
    const raw = scene()
    raw.files.f.dataURL = `data:image/png;base64,${exif.toString('base64')}`
    const clean = await sanitizeScene(raw)
    const bytes = Buffer.from(clean.files.f.dataURL.split(',')[1], 'base64')
    expect(bytes.includes(Buffer.from('합성'))).toBe(false)
    expect((await sharp(bytes).metadata()).exif).toBeUndefined()
  })

  const dataUrl = (mime: string, bytes: Uint8Array | string) =>
    `data:${mime};base64,${Buffer.from(bytes as Uint8Array).toString('base64')}`
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'

  it('내장 SVG는 PNG로 굽고 형식을 고친다', async () => {
    const raw = scene()
    raw.files.f.dataURL = dataUrl('image/svg+xml', svg)
    const diag: string[] = []
    const clean = await sanitizeScene(raw, (key) => diag.push(key))
    expect(clean.files.f.mimeType).toBe('image/png')
    expect(clean.files.f.dataURL).toMatch(/^data:image\/png;base64,/)
    const bytes = Buffer.from(clean.files.f.dataURL.split(',')[1], 'base64')
    expect((await sharp(bytes).metadata()).format).toBe('png')
    expect(diag).toEqual(['image/svg+xml|svg|CONVERTED'])
  })

  it.each([
    [
      'URL 인코딩',
      () => `data:image/svg+xml,${encodeURIComponent(svg)}`,
      'image/svg+xml|svg|CONVERTED',
    ],
    [
      'charset',
      () => `data:image/svg+xml;charset=utf-8;base64,${Buffer.from(svg).toString('base64')}`,
      'image/svg+xml|svg|CONVERTED',
    ],
    [
      '대문자',
      () => embeddedPng.replace('data:image/png;base64', 'DATA:IMAGE/PNG;BASE64'),
      'image/png|png|OK',
    ],
    ['image/jpg 선언', () => embeddedPng.replace('image/png', 'image/jpg'), 'image/jpg|png|OK'],
  ])('dataURL 변형을 받는다: %s', async (_name, make, key) => {
    const raw = scene()
    raw.files.f.dataURL = make()
    const diag: string[] = []
    const clean = await sanitizeScene(raw, (entry) => diag.push(entry))
    expect(clean.files.f.dataURL).toMatch(/^data:image\/png;base64,/)
    expect(diag).toEqual([key])
  })

  it.each([
    ['잘린 이미지', () => embeddedPng.slice(0, 60), 'SCENE_IMAGE_CORRUPT'],
    ['원격 URL', () => 'https://cdn.example.test/a.png', 'SCENE_IMAGE_REMOTE'],
    ['base64 깨짐', () => 'data:image/png;base64,###', 'SCENE_IMAGE_MALFORMED'],
    ['이미지 아님', () => dataUrl('text/plain', 'hello'), 'SCENE_IMAGE_UNSUPPORTED'],
    [
      '외부 참조 SVG',
      () =>
        dataUrl('image/svg+xml', svg.replace('<rect', '<image href="file:///etc/hosts"/><rect')),
      'SVG_EXTERNAL_REF',
    ],
  ])('복구할 수 없으면 보류한다: %s', async (_name, make, code) => {
    const raw = scene()
    raw.files.f.dataURL = make()
    await expect(sanitizeScene(raw)).rejects.toThrow(code)
  })

  it('파일이 없는 이미지 요소는 빼고 나머지를 살린다', async () => {
    for (const files of [undefined, null, { f: null }, {}]) {
      const diag: string[] = []
      const clean = await sanitizeScene({ ...scene(), files } as Record<string, unknown>, (key) =>
        diag.push(key)
      )
      expect(clean.elements.map((element: { id: string }) => element.id)).toEqual(['a'])
      expect(clean.files).toEqual({})
      expect(diag).toEqual(['none|none|ELEMENT_DROPPED_NO_FILE'])
    }
  })

  it('진단은 실패해도 모든 파일을 세고 값을 담지 않는다', async () => {
    const raw = scene()
    raw.elements.push({ id: 'j', type: 'image', fileId: 'g' })
    Object.assign(raw.files, {
      f: { id: 'f', dataURL: dataUrl('text/x-합성값', 'hello') },
      g: { id: 'g', dataURL: embeddedPng },
    })
    const diag: string[] = []
    await expect(sanitizeScene(raw, (key) => diag.push(key))).rejects.toThrow(
      'SCENE_IMAGE_UNSUPPORTED'
    )
    expect(diag).toEqual(['other|unknown|ASSET_UNSUPPORTED_TYPE', 'image/png|png|OK'])
  })

  it('독립 SVG 자산도 PNG가 된다', async () => {
    const clean = await cleanImage(Buffer.from(svg))
    expect(clean.mimeType).toBe('image/png')
    expect((await sharp(clean.bytes).metadata()).format).toBe('png')
    await expect(cleanImage(Buffer.from('hello'))).rejects.toThrow('ASSET_UNSUPPORTED_TYPE')
  })
})

describe('prepare', () => {
  it('REPEATABLE READ READ ONLY 트랜잭션에서 SELECT만 실행한다', async () => {
    const { client, queries } = fakeSource()
    await prepareOpeningCustomer(client, readObject, {
      brandId: '9',
      webOrigin: 'https://opening.work',
    })
    expect(queries[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(queries.at(-1)).toBe('COMMIT')
    for (const sql of queries.slice(1, -1)) {
      expect(sql.trim()).toMatch(/^SELECT/)
      expect(sql).not.toMatch(
        /manager|member|detail_text|FROM application|pay_customer|pay_subscription/i
      )
    }
  })

  it('조회 실패 시 ROLLBACK한다', async () => {
    const queries: string[] = []
    const client: OpeningSourceClient = {
      query: async (sql) => {
        queries.push(sql)
        if (sql.includes('now()')) throw Error('boom')
        return { rows: [] }
      },
    }
    await expect(
      prepareOpeningCustomer(client, readObject, { brandId: '9', webOrigin: 'https://x.test' })
    ).rejects.toThrow('boom')
    expect(queries.at(-1)).toBe('ROLLBACK')
  })

  it('포함·제외·보류 사유와 updated_at 전용 군집을 집계한다', async () => {
    const { summary, manifest, postings } = await prepare()
    expect(safeMigrationSummary(summary)).not.toHaveProperty('sourceSpaceId')
    expect(safeMigrationSummary(summary)).not.toHaveProperty('schemaIssues')
    expect(safeMigrationSummary(summary)).not.toHaveProperty('sceneImageDiag')
    expect(safeMigrationSummary(summary)).not.toHaveProperty('assetImageDiag')
    expect(
      safeMigrationSummary({
        ...summary,
        extraCustomerIdentifier: 'privateperson',
        postings: {
          ...summary.postings,
          unexpected: 'privateperson',
          reasons: { privateperson: 1 },
        },
        updatedOnly: { count: 1, byDate: { '2026-01-01': 1 } },
      })
    ).toMatchObject({ postings: { total: summary.postings.total }, updatedOnly: { count: 1 } })
    expect(
      JSON.stringify(
        safeMigrationSummary({
          ...summary,
          extraCustomerIdentifier: 'privateperson',
          postings: {
            ...summary.postings,
            unexpected: 'privateperson',
            reasons: { privateperson: 1 },
          },
          updatedOnly: { count: 1, byDate: { '2026-01-01': 1 } },
        })
      )
    ).not.toMatch(/privateperson|2026-01-01/)
    expect(summary.postings).toMatchObject({ total: 7, included: 2, held: 3, excluded: 2 })
    expect(summary.postings.reasons).toEqual({
      HELD_CONTACT_PATTERN: 2,
      CONTENT_UNSUPPORTED_ATTRIBUTE: 1,
      OUT_OF_WINDOW: 1,
      DELETED: 1,
    })
    expect(summary.updatedOnly).toEqual({ count: 1, byDate: { '2026-03-02': 1 } })
    expect(summary.contactHits).toMatchObject({ phone: 2, email: 1, postingsHit: 2 })
    expect(summary.review).toEqual({ released: 0, stale: 0, pendingItems: 2 })
    expect(summary.images.manualReview).toBeGreaterThan(0)
    expect(summary.removedSections.managerSections).toBeGreaterThan(0)
    expect(postings.map((p) => p.sourcePostingId)).toEqual(['1', '2'])
    expect(manifest.postings.find((p) => p.id === '5')?.status).toBe('held')
    expect(manifest.postings.find((p) => p.id === '4')?.reasons).toEqual(['DELETED'])
  })

  it('packet과 manifest에 본문 외 원문·연락처·S3 키가 남지 않는다', async () => {
    const { manifest, org, postings, templates } = await prepare()
    const packets = JSON.stringify({ org, postings, templates })
    expect(packets).not.toMatch(/manager|member|사람이름|signed\.example|비활성|file_key/)
    const manifestText = JSON.stringify(manifest)
    expect(manifestText).not.toMatch(/합성 공고|합성 제목|합성브랜드|사람이름|content_image\//)
    expect(postings[0].content.detail.map((s) => s.type)).toEqual([
      'posting_title',
      'posting_positions',
      'posting_stores',
      'content',
      'image',
    ])
    expect(postings[0].positions[0]).toMatchObject({
      sourcePositionId: '30',
      fields: {
        payFrequency: 'HOURLY',
        workDays: [1, 2, 3, 4, 5],
        experience: '신입',
        headcount: 2,
      },
    })
    expect(postings[0].content.positionConditionsText).toBe('합성 직무: 일반 모집, 근무 3개월')
    expect(postings[0].historicalStoreIds).toEqual(['21'])
    expect(org.stores.find((s) => s.sourceId === '21')?.isActive).toBe(false)
  })

  it('보류된 공고에만 쓰인 이미지는 자산 목록에서 뺀다', async () => {
    const { assets, manifest } = await prepare()
    const held = manifest.postings.find((p) => p.id === '6')
    expect(held?.status).toBe('held')
    const included = manifest.postings
      .filter((p) => p.status === 'included')
      .flatMap((p) => p.imageSha256)
    const templateImages = manifest.templates.flatMap((t) => t.imageSha256)
    expect([...assets.keys()].sort()).toEqual([...new Set([...included, ...templateImages])].sort())
    // b.png는 보류 공고 6에서만 쓴다.
    const onlyHeld = await readObject({ bucket: 'bucket', key: 'content_image/b.png' })
    expect(assets.has(createHash('sha256').update(onlyHeld).digest('hex'))).toBe(false)
    expect(assets.size).toBeGreaterThan(0)
  })

  it('옛 공고 지원 링크는 지원 폼으로 잇고 외부 링크와 남은 opening 주소는 구분한다', async () => {
    const rows = sourceRows()
    const link = (url: string) => ({ type: 'content_link', enabled: true, resource_id: 70, url })
    rows.postings[0].detail = [
      link('https://opening.work/p/other/apply'),
      link('https://example.test/brand'),
      { type: 'custom', enabled: true, items: [{ label: '안내', value: 'opening.work/p/old' }] },
    ] as never
    const { postings, summary, manifest } = await prepare(rows)
    expect(postings[0].content.detail.map((section) => section.url)).toEqual([
      'https://opening.work/p/pub1',
      'https://example.test/brand',
      undefined,
    ])
    expect(summary.postings.warnings).toEqual({ OPENING_URL_REMAINS: 1 })
    expect(manifest.postings.find((p) => p.id === '1')?.warnings).toEqual(['OPENING_URL_REMAINS'])
  })

  it('제목 없는 공고는 스키마 거부가 아니라 NO_TITLE로 제외한다', async () => {
    const rows = sourceRows()
    rows.postings[0].title = '  '
    const { manifest, summary } = await prepare(rows)
    const entry = manifest.postings.find((p) => p.id === '1')
    expect(entry).toMatchObject({ status: 'excluded', reasons: ['NO_TITLE'] })
    expect(summary.postings.reasons.NO_TITLE).toBe(1)
    expect(summary.schemaIssues).toEqual({})
  })

  it('직무·매장 보류 사유를 값 없이 집계하고 직무명 키워드로는 보류하지 않는다', async () => {
    const rows = sourceRows()
    rows.positions[0].name = '인사 담당자'
    rows.positions.push({ ...rows.positions[0], id: '31', name: '' })
    rows.positions.push({ ...rows.positions[0], id: '32', name: '문의 010-1234-5678' })
    const { summary, manifest, org } = await prepare(rows)
    expect(org.positions.map((p) => p.sourceId)).toEqual(['30'])
    expect(manifest.heldOrg.positions).toEqual(['31', '32'])
    expect(summary.positions.heldReasons).toEqual({ FORMAT: 1, CONTACT_PATTERN: 1 })
    expect(summary.schemaIssues).toEqual({ 'position:name:too_small': 1 })
    expect(JSON.stringify(summary)).not.toContain('010-1234-5678')
  })

  it('스키마 거부는 값 없이 경로와 코드만 집계한다', async () => {
    const rows = sourceRows()
    rows.postingPositions[0].name = '합성 비밀 문항'.repeat(50)
    const { summary, manifest } = await prepare(rows)
    expect(manifest.postings.find((p) => p.id === '1')?.reasons).toEqual(['PACKET_SCHEMA_REJECTED'])
    expect(summary.schemaIssues).toEqual({
      'posting:positions.*.fields.name:too_big': 1,
    })
    expect(JSON.stringify(summary)).not.toContain('합성 비밀 문항')
  })

  it('매장 형식 오류는 그 매장만 보류하고 경로만 집계한다', async () => {
    const rows = sourceRows()
    rows.stores[0].name = ''
    const { manifest, summary } = await prepare(rows)
    expect(manifest.heldOrg.stores).toEqual(['20'])
    expect(summary.schemaIssues).toEqual({ 'store:name:too_small': 1 })
    expect(manifest.postings.find((p) => p.id === '1')?.reasons).toEqual(['STORE_UNAVAILABLE'])
  })

  it('섹션이 가리키는 이미지가 다른 고객 파일이면 보류하고 공통 샘플이면 허용한다', async () => {
    const rows = sourceRows()
    const key = 'posting_detail/u/사람이름.png'
    const shared = rows.files.find((row) => row.file_key === key)
    Object.assign(shared as object, { owner_brand_id: '8' })
    let result = await prepare(rows)
    expect(result.manifest.postings.find((p) => p.id === '1')?.reasons).toEqual([
      'ASSET_SCOPE_MISMATCH',
    ])
    Object.assign(shared as object, { owner_brand_id: null })
    result = await prepare(rows)
    expect(result.manifest.postings.find((p) => p.id === '1')?.reasons).toEqual([
      'ASSET_SCOPE_UNKNOWN',
    ])
    Object.assign(shared as object, { owner_brand_id: '8' })
    rows.sampleTemplates = [
      {
        id: '500',
        status: 1,
        image_key: '',
        data: [{ type: 'image', enabled: true, image_key: key }],
      },
    ]
    result = await prepare(rows)
    expect(result.manifest.postings.find((p) => p.id === '1')?.status).toBe('included')
  })

  it.each([
    ['비활성 템플릿', { status: 0, data: [{ type: 'image', enabled: true }] }],
    ['비활성 섹션', { status: 1, data: [{ type: 'image', enabled: false }] }],
    ['미참조 content', { status: 1, data: [] }],
  ])('공용 샘플 %s 자산은 허용하지 않는다', async (_label, sample) => {
    const rows = sourceRows()
    const key = 'posting_detail/u/사람이름.png'
    rows.files.find((row) => row.file_key === key)!.owner_brand_id = '8'
    rows.sampleTemplates = [
      {
        id: '500',
        image_key: '',
        ...sample,
        data: sample.data.map((item) => ({ ...item, image_key: key })),
      },
    ]
    rows.sampleContents = [{ id: '700', source_id: '500', status: 1, image_key: key }]
    const result = await prepare(rows)
    expect(result.manifest.postings.find((p) => p.id === '1')?.reasons).toContain(
      'ASSET_SCOPE_MISMATCH'
    )
  })

  it('자격증명·서명이 든 URL은 승인할 수 없는 보류로 둔다', async () => {
    const rows = sourceRows()
    rows.postings[0].detail = [
      { type: 'content_link', enabled: true, resource_id: 70, url: 'https://x.test/?token=a' },
    ] as never
    const { manifest, summary } = await prepare(rows)
    expect(manifest.postings.find((p) => p.id === '1')?.reasons).toEqual(['HELD_SENSITIVE_URL'])
    expect(summary.review.pendingItems).toBe(2)
  })

  it('다른 고객 소유 content를 쓰는 공고는 보류한다', async () => {
    const rows = sourceRows()
    rows.contents[0].owner_brand_id = '8'
    const { manifest } = await prepare(rows)
    expect(manifest.postings.find((p) => p.id === '1')?.reasons).toEqual([
      'RESOURCE_SCOPE_MISMATCH',
    ])
  })

  it.each([
    ['content_image/a.png', '8', 'ASSET_SCOPE_MISMATCH'],
    ['content_image/a.png', null, 'ASSET_SCOPE_UNKNOWN'],
    ['content_data/a.json', '8', 'ASSET_SCOPE_MISMATCH'],
    ['content_data/a.json', null, 'ASSET_SCOPE_UNKNOWN'],
  ])(
    'resource 파일의 소유권이 맞지 않으면 읽기 전에 보류한다: %s / %s',
    async (key, owner, reason) => {
      const rows = sourceRows()
      const asset = rows.files.find((row) => row.file_key === key)!
      asset.owner_brand_id = owner
      const reads: string[] = []
      const result = await prepareOpeningCustomer(
        fakeSource(rows).client,
        async (input) => {
          reads.push(input.key)
          return readObject(input)
        },
        { brandId: '9', webOrigin: 'https://opening.work' }
      )
      expect(result.manifest.postings.find((p) => p.id === '1')?.reasons).toContain(reason)
      expect(reads).not.toContain(key)
    }
  )

  it('검증된 공통 샘플 resource 이미지는 기존대로 허용한다', async () => {
    const rows = sourceRows()
    const key = 'content_image/a.png'
    rows.files.find((row) => row.file_key === key)!.owner_brand_id = '8'
    rows.sampleTemplates = [
      {
        id: '500',
        status: 1,
        image_key: '',
        data: [{ type: 'content', enabled: true, resource_id: '700' }],
      },
    ]
    rows.sampleContents = [{ id: '700', source_id: '500', status: 1, image_key: key }]
    const result = await prepare(rows)
    expect(result.manifest.postings.find((p) => p.id === '1')?.status).toBe('included')
  })

  it.each([
    ['비활성 content', { status: 0, source_id: '500' }],
    ['다른 템플릿의 content', { status: 1, source_id: '501' }],
  ])('공통 샘플의 %s는 허용하지 않는다', async (_label, overrides) => {
    const rows = sourceRows()
    const key = 'content_image/a.png'
    rows.files.find((row) => row.file_key === key)!.owner_brand_id = '8'
    rows.sampleTemplates = [
      {
        id: '500',
        status: 1,
        image_key: '',
        data: [{ type: 'content', enabled: true, resource_id: '700' }],
      },
    ]
    rows.sampleContents = [{ id: '700', image_key: key, ...overrides }]
    const result = await prepare(rows)
    expect(result.manifest.postings.find((p) => p.id === '1')?.reasons).toContain(
      'ASSET_SCOPE_MISMATCH'
    )
  })

  it('공통 샘플 이미지 목록에 들어간 다른 고객의 scene은 허용하지 않는다', async () => {
    const rows = sourceRows()
    const key = 'content_data/a.json'
    rows.files.find((row) => row.file_key === key)!.owner_brand_id = '8'
    rows.sampleContents = [{ image_key: key }]
    const result = await prepare(rows)
    expect(result.manifest.postings.find((p) => p.id === '1')?.reasons).toContain(
      'ASSET_SCOPE_MISMATCH'
    )
  })

  it('이미지가 아닌 자산은 복사하지 않고 보류한다', async () => {
    const { manifest } = await prepareOpeningCustomer(
      fakeSource().client,
      async (object) =>
        object.key.endsWith('.json') ? readObject(object) : Buffer.from('not an image'),
      { brandId: '9', webOrigin: 'https://opening.work' }
    )
    expect(manifest.postings.find((p) => p.id === '1')?.reasons).toEqual(['ASSET_UNSUPPORTED_TYPE'])
  })

  it('없는 고객이면 고정 코드로 중단한다', async () => {
    const client: OpeningSourceClient = {
      query: async (sql) => ({
        rows: sql.includes('now()') ? [{ snapshot_at: snapshotAt }] : [],
      }),
    }
    await expect(
      prepareOpeningCustomer(client, readObject, { brandId: '9', webOrigin: 'https://x.test' })
    ).rejects.toThrow('SOURCE_BRAND_NOT_FOUND')
  })
})

describe('import', () => {
  const poison: [string, (packet: PostingPacket & Record<string, unknown>) => void][] = [
    ['managerName', (p) => Object.assign(p, { managerName: '합성' })],
    ['sourceMemberId', (p) => Object.assign(p, { sourceMemberId: '2' })],
    ['rawSnapshot', (p) => Object.assign(p, { rawSnapshot: { synthetic: true } })],
    ['applications', (p) => Object.assign(p, { applications: [] })],
    ['posting.managerPhone', (p) => Object.assign(p.posting, { managerPhone: 'x' })],
    ['content.managerText', (p) => Object.assign(p.content, { managerText: '합성' })],
    [
      'manager 섹션',
      (p) =>
        p.content.detail.push({
          type: 'manager',
          enabled: true,
        } as unknown as (typeof p.content.detail)[0]),
    ],
    [
      '비활성 섹션',
      (p) =>
        p.content.detail.push({
          type: 'custom',
          enabled: false,
          items: [],
        } as unknown as (typeof p.content.detail)[0]),
    ],
    ['섹션 추가 키', (p) => Object.assign(p.content.detail[0], { file_key: 'x' })],
    ['직무 추가 키', (p) => Object.assign(p.positions[0], { authorId: '1' })],
    ['직무 fields 추가 키', (p) => Object.assign(p.positions[0].fields, { managerName: 'x' })],
    ['폼 추가 키', (p) => Object.assign(p.posting.applicationEntries[0], { value: 'x' })],
  ]

  it.each(poison)('오염 packet(%s)은 쓰기 전에 전체 거부한다', async (_name, poisonFn) => {
    const prepared = await prepare()
    poisonFn(prepared.postings[0] as PostingPacket & Record<string, unknown>)
    const { db, records, stores } = fakeDb()
    await expect(importSet(db, prepared, true)).rejects.toThrow('PACKET_SCHEMA_REJECTED')
    expect(records.size).toBe(0)
    expect(stores.size).toBe(0)
  })

  it.each([
    ['제목', (p: PostingPacket) => (p.posting.title = '문의 010-1234-5678')],
    ['소개', (p: PostingPacket) => (p.content.companyIntro = 'hr@synthetic.test')],
    [
      'scene',
      (p: PostingPacket) =>
        Object.values(p.content.resources)[0].scene?.elements.push({ text: '010-1234-5678' }),
    ],
  ])('prepare 뒤 %s에 넣은 연락처도 적재에서 다시 막는다', async (_name, edit) => {
    const prepared = await prepare()
    edit(prepared.postings[0])
    const { db, records } = fakeDb()
    await expect(importSet(db, prepared, true)).rejects.toThrow('HELD_CONTACT_PATTERN')
    expect(records.size).toBe(0)
  })

  it('12개월 밖 packet은 거부한다', async () => {
    const prepared = await prepare()
    prepared.postings[0].posting.createdAt = old.toISOString()
    prepared.postings[0].posting.updatedAt = old.toISOString()
    const { db, records } = fakeDb()
    await expect(importSet(db, prepared, true)).rejects.toThrow('OUT_OF_WINDOW')
    expect(records.size).toBe(0)
  })

  it('dry-run은 원장·대상·Storage를 쓰지 않는다', async () => {
    const prepared = await prepare()
    const { db, records, postings } = fakeDb()
    const { objects, storage } = memoryStorage()
    const report = await importSet(db, prepared, false, storage)
    expect(report.status).toBe('PLANNED')
    expect(report.postings.created).toBe(2)
    expect(records.size + postings.size + objects.size).toBe(0)
  })

  it('apply는 DRAFT·알림 꺼짐·담당자 없음으로 적재하고 원장은 posting-v2 allowlist만 담는다', async () => {
    const prepared = await prepare()
    const { db, records, postings, stores, templates } = fakeDb()
    const { objects, storage } = memoryStorage()
    const report = await importSet(db, prepared, true, storage)
    expect(report).toMatchObject({
      status: 'APPLIED',
      stores: { created: 2 },
      positions: { created: 1 },
      templates: { created: 1 },
      postings: { created: 2 },
    })
    expect(objects.size).toBe(report.assets.total)
    expect(templates.size).toBe(1)
    const [posting] = [...postings.values()]
    expect(posting).toMatchObject({
      status: 'DRAFT',
      notificationEnabled: false,
      publishedAt: null,
      spaceId: 'space',
    })
    expect(Object.keys(posting).filter((key) => /manager|author/i.test(key))).toEqual([])
    const links = posting.stores as { create: { storeId: string }[] }
    expect(links.create.map((link) => link.storeId).sort()).toEqual(
      [...stores.values()].map((store) => store.id).sort()
    )
    const record = records.get(
      migrationSourceRef({
        sourceSystem: 'opening.work',
        sourceTable: 'posting',
        sourceId: '1',
        occurrence: '0',
      })
    ) as unknown as HiringMigrationRecord
    expect(record.transformVersion).toBe('posting-v2')
    const snapshot = decodeMigrationSnapshot(record) as Record<string, unknown>
    expect(Object.keys(snapshot).sort()).toEqual([
      'content',
      'historicalStoreIds',
      'positions',
      'posting',
      'sourcePostingId',
      'sourceSpaceId',
      'sourceStoreIds',
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/manager|member|author|target/i)
  })

  it('같은 자료를 다시 돌리면 쓰지 않고 건너뛴다(T가 달라도)', async () => {
    const first = await prepare()
    const { db, records } = fakeDb()
    await importSet(db, first, true)
    const size = records.size
    const again = await prepare()
    for (const packet of again.postings)
      packet.sourceSnapshotAt = new Date(snapshotAt.getTime() + 1000).toISOString()
    const report = await importSet(db, again, true)
    expect(report).toMatchObject({
      status: 'APPLIED',
      stores: { created: 0, skipped: 2 },
      templates: { skipped: 1 },
      postings: { created: 0, skipped: 2 },
    })
    expect(records.size).toBe(size)
  })

  it('원본이 바뀌면 충돌로 멈추고 새 항목도 쓰지 않는다', async () => {
    const first = await prepare()
    const { db, positions } = fakeDb()
    await importSet(db, first, true)
    const changed = await prepare()
    changed.postings[0].posting.title = '수정된 합성 공고'
    changed.org.positions.push({ ...changed.org.positions[0], sourceId: '31' })
    const report = await importSet(db, changed, true)
    expect(report).toMatchObject({ status: 'CONFLICT_STOPPED', postings: { conflict: 1 } })
    expect(positions.size).toBe(1)
  })

  it('고객이 대상을 수정했으면 충돌로 멈춘다', async () => {
    const first = await prepare()
    const { db, postings, stores } = fakeDb()
    await importSet(db, first, true)
    ;[...stores.values()][0].name = '고객이 바꾼 이름'
    ;[...postings.values()][0].title = '고객이 바꾼 제목'
    const report = await importSet(db, await prepare(), true)
    expect(report).toMatchObject({
      status: 'CONFLICT_STOPPED',
      stores: { conflict: 1 },
      postings: { conflict: 1 },
    })
  })

  it('기존 v1 기록은 충돌로 남겨 두고 건드리지 않는다', async () => {
    const prepared = await prepare()
    const { db, records } = fakeDb()
    const sourceRef = migrationSourceRef({
      sourceSystem: 'opening.work',
      sourceTable: 'posting',
      sourceId: '1',
      occurrence: '0',
    })
    const v1 = {
      id: 'v1',
      spaceId: 'space',
      sourceRef,
      transformVersion: 'posting-v1',
      sourceHash: 'x',
      targetModel: 'HiringPosting',
      targetId: 'old',
    }
    records.set(sourceRef, { ...v1 })
    const report = await importSet(db, prepared, true)
    expect(report).toMatchObject({ status: 'CONFLICT_STOPPED', postings: { conflict: 1 } })
    expect(records.get(sourceRef)).toEqual(v1)
  })

  it('공개 키가 이미 쓰이면 충돌로 멈춘다', async () => {
    const prepared = await prepare()
    const { db, postings } = fakeDb()
    postings.set('x', { id: 'x', spaceId: 'other', uuid: prepared.postings[0].posting.uuid })
    const report = await importSet(db, prepared, true)
    expect(report).toMatchObject({ status: 'CONFLICT_STOPPED', postings: { conflict: 1 } })
  })

  it('공고가 참조하는 매장이 org packet에 없으면 거부한다', async () => {
    const prepared = await prepare()
    prepared.org.stores = prepared.org.stores.slice(1)
    await expect(importSet(fakeDb().db, prepared, false)).rejects.toThrow(
      'MIGRATION_REFERENCE_UNMAPPED'
    )
  })

  it('apply인데 Storage가 없으면 시작하지 않는다', async () => {
    const prepared = await prepare()
    await expect(
      runOpeningImport(fakeDb().db as unknown as FakeDb, prepared, {
        spaceId: 'space',
        brandId: '9',
        apply: true,
        review: reviewFile(),
        readAsset: async () => new Uint8Array(),
      })
    ).rejects.toThrow('TARGET_STORAGE_REQUIRED')
  })
})

describe('사람 검토', () => {
  async function approved() {
    const first = await prepare()
    const items = first.review.items.map(({ kind, id, contentHash }) => ({ kind, id, contentHash }))
    const images = first.review.images.map((image) => image.sha256)
    return { first, items, images }
  }

  it('검토 대상은 원문과 이미지까지 내주고 packet에는 넣지 않는다', async () => {
    const { first } = await approved()
    expect(first.review.items.map((item) => item.id)).toEqual(['5', '6'])
    const flagged = first.review.items[0].texts.filter((text) => text.flagged)
    expect(flagged[0].text).toContain('010-1234-5678')
    expect(first.review.images.length).toBeGreaterThan(0)
    expect(first.postings.map((p) => p.sourcePostingId)).toEqual(['1', '2'])
  })

  it('숫자만 있는 값·키도 검토 원문에 적중으로 나온다', () => {
    const texts = reviewTexts({ a: '010-1234-5678', b: '01012345678', '0212345678': 'x', c: 'abc' })
    expect(texts.filter((text) => text.flagged).map((text) => text.text)).toEqual([
      '010-1234-5678',
      '01012345678',
      '0212345678',
    ])
    expect(texts.some((text) => text.text === 'abc')).toBe(false)
  })

  it('승인하면 보류를 풀고, 같은 검토 파일로 적재할 수 있다', async () => {
    const { first, items, images } = await approved()
    const review = reviewFile({ items, images })
    const released = await prepare(sourceRows(), review)
    expect(released.summary.review).toEqual({ released: 2, stale: 0, pendingItems: 0 })
    expect(released.postings.map((p) => p.sourcePostingId)).toEqual(['1', '2', '5', '6'])
    expect(released.manifest.review).toEqual({
      reviewer: '합성 검토자',
      reviewedAt: '2026-11-01',
    })
    expect(released.manifest.postings.find((p) => p.id === '5')?.released).toBe(true)
    expect(reviewHash(released.postings[2])).toBe(items[0].contentHash)
    expect(first.review.items).toHaveLength(2)

    const { db, postings } = fakeDb()
    const report = await importSet(db, released, true, undefined, {
      review: reviewFile({
        items,
        images: released.manifest.manualReviewImages.map((image) => image.sha256),
      }),
    })
    expect(report.status).toBe('APPLIED')
    expect(postings.size).toBe(4)
  })

  it('승인 뒤 내용이 바뀌면 다시 보류하고 REVIEW_STALE로 알린다', async () => {
    const { items, images } = await approved()
    const rows = sourceRows()
    rows.postings[2].detail = [
      {
        type: 'custom',
        enabled: true,
        items: [{ label: '문의', value: '연락 010-1234-9999' }],
      },
    ]
    const { summary, manifest, postings } = await prepare(rows, reviewFile({ items, images }))
    expect(summary.review).toMatchObject({ released: 1, stale: 1, pendingItems: 1 })
    expect(manifest.postings.find((p) => p.id === '5')?.warnings).toContain('REVIEW_STALE')
    expect(postings.map((p) => p.sourcePostingId)).not.toContain('5')
  })

  it('승인 없이 적재 packet에 연락처가 있으면 전체 중단한다', async () => {
    const { items, images } = await approved()
    const released = await prepare(sourceRows(), reviewFile({ items, images }))
    const { db, records } = fakeDb()
    await expect(importSet(db, released, true)).rejects.toThrow('HELD_CONTACT_PATTERN')
    expect(records.size).toBe(0)
  })

  it('민감 URL은 검토 파일로 풀 수 없다', async () => {
    const prepared = await prepare()
    prepared.postings[0].content.companyIntro = 'https://x.test/?token=a'
    const packet = prepared.postings[0]
    const { db } = fakeDb()
    await expect(
      importSet(db, prepared, true, undefined, {
        review: reviewFile({
          items: [{ kind: 'posting', id: '1', contentHash: reviewHash(packet) }],
          images: prepared.manifest.manualReviewImages.map((image) => image.sha256),
        }),
      })
    ).rejects.toThrow('HELD_SENSITIVE_URL')
  })

  it.each([
    ['검토자 없음', { reviewer: ' ' }, 'REVIEW_FILE_INVALID'],
    ['날짜 없음', { reviewedAt: '어제' }, 'REVIEW_FILE_INVALID'],
    ['추가 키', { note: 'x' }, 'REVIEW_FILE_INVALID'],
    ['잘못된 해시', { images: ['x'] }, 'REVIEW_FILE_INVALID'],
    ['다른 고객', { sourceSpaceId: '8' }, 'REVIEW_SCOPE_MISMATCH'],
  ])('검토 파일 오류: %s', async (_name, overrides, code) => {
    await expect(prepare(sourceRows(), reviewFile(overrides))).rejects.toThrow(code)
  })

  it('검토 폴더는 저장소 밖 빈 폴더만 받고 소유자 전용으로 쓴다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opening-review-'))
    try {
      expect(() => assertOutDir(join(root, 'repo/inside'), join(root, 'repo'))).toThrow(
        'OUT_DIR_INSIDE_REPO'
      )
      const dir = assertOutDir(join(root, 'review'), join(root, 'repo'))
      const { review } = await prepare()
      writeReviewDir(dir, review)
      expect(() => assertOutDir(dir, join(root, 'repo'))).toThrow('OUT_DIR_NOT_EMPTY')
      const paths = [
        'candidates.json',
        ...readdirSync(join(dir, 'items')).map((name) => join('items', name)),
        ...readdirSync(join(dir, 'images')).map((name) => join('images', name)),
      ]
      expect(paths.length).toBeGreaterThan(3)
      for (const path of paths) expect(statSync(join(dir, path)).mode & 0o777).toBe(0o600)
      for (const path of ['.', 'items', 'images'])
        expect(statSync(join(dir, path)).mode & 0o777).toBe(0o700)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('적재 게이트', () => {
  it.each([
    'data:image/png;base64,%%%%',
    'data:image/png;base64,YQ==',
    'data:image/jpeg;base64,YQ==',
    'https://example.test/image.png',
  ])('잘못된 내장 이미지 dataURL은 거부한다: %s', async (dataURL) => {
    const prepared = await prepare()
    const content = prepared.postings[0].content
    const embedded = await sanitizeScene(scene())
    embedded.files.f.dataURL = dataURL
    content.resources['70'].scene = embedded
    expect(() => embeddedImages(content)).toThrow('SCENE_IMAGE_INVALID')
  })

  it('내장 이미지의 MIME이 실제 PNG와 다르면 거부한다', async () => {
    const content = (await prepare()).postings[0].content
    const embedded = await sanitizeScene(scene())
    embedded.files.f.dataURL = embedded.files.f.dataURL.replace('image/png', 'image/jpeg')
    embedded.files.f.mimeType = 'image/jpeg'
    content.resources['70'].scene = embedded
    expect(() => embeddedImages(content)).toThrow('SCENE_IMAGE_INVALID')
  })

  it('내장 이미지 검토 파일을 제공하고 바이트 SHA 승인 후에만 적재한다', async () => {
    const read: OpeningObjectReader = async (input) =>
      ['content_data/a.json', 'content_data/c.json'].includes(input.key)
        ? Buffer.from(JSON.stringify(scene()))
        : readObject(input)
    const initial = await prepareOpeningCustomer(fakeSource().client, read, {
      brandId: '9',
      webOrigin: 'https://opening.work',
    })
    const embedded = await sanitizeScene(scene())
    const bytes = Buffer.from(embedded.files.f.dataURL.split(',')[1], 'base64')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    expect(
      initial.review.images.filter((image) => image.owners.includes('posting:1')).length
    ).toBeGreaterThan(1)
    expect(initial.review.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sha256,
          bytes,
          owners: expect.arrayContaining(['posting:1', 'template:40']),
        }),
      ])
    )
    const reviewDir = mkdtempSync(join(tmpdir(), 'embedded-review-'))
    try {
      writeReviewDir(reviewDir, initial.review)
      expect(readFileSync(join(reviewDir, 'images', `${sha256}.png`))).toEqual(bytes)
      expect(statSync(join(reviewDir, 'images', `${sha256}.png`)).mode & 0o777).toBe(0o600)
    } finally {
      rmSync(reviewDir, { recursive: true, force: true })
    }
    expect(initial.manifest.postings.find((item) => item.id === '1')?.status).toBe('held')
    const images = initial.manifest.manualReviewImages.map((image) => image.sha256)
    const approved = await prepareOpeningCustomer(fakeSource().client, read, {
      brandId: '9',
      webOrigin: 'https://opening.work',
      review: reviewFile({ images }),
    })
    expect(approved.manifest.postings.find((item) => item.id === '1')?.status).toBe('included')
    expect(approved.manifest.templates.find((item) => item.id === '40')?.status).toBe('included')
    const report = await importSet(fakeDb().db, approved, true, undefined, {
      review: reviewFile({ images }),
    })
    expect(report.issues.refused).toEqual([])
    const withoutEmbedded = await importSet(fakeDb().db, approved, true, undefined, {
      review: reviewFile({ images: images.filter((image) => image !== sha256) }),
    })
    expect(withoutEmbedded.issues.refused).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'posting',
          id: '1',
          code: 'EMBEDDED_IMAGE_REVIEW_REQUIRED',
        }),
        expect.objectContaining({
          kind: 'template',
          id: '40',
          code: 'EMBEDDED_IMAGE_REVIEW_REQUIRED',
        }),
      ])
    )
    const resource = approved.postings[0].content.resources['70']
    const noBinding = async () => {
      throw Error('BIND_SHOULD_NOT_RUN')
    }
    await expect(planPosting(approved.postings[0], 'space', noBinding)).rejects.toThrow(
      'EMBEDDED_IMAGE_REVIEW_REQUIRED'
    )
    await expect(planTemplate(approved.templates[0], 'space', 'owner', noBinding)).rejects.toThrow(
      'EMBEDDED_IMAGE_REVIEW_REQUIRED'
    )
    resource.scene!.files.f.dataURL = `data:image/png;base64,${Buffer.from(await png(99)).toString('base64')}`
    await expect(
      planPosting(
        approved.postings[0],
        'space',
        noBinding,
        parseReviewFile(reviewFile({ images }), '9')
      )
    ).rejects.toThrow('EMBEDDED_IMAGE_REVIEW_REQUIRED')
    const changed = await importSet(fakeDb().db, approved, true, undefined, {
      review: reviewFile({ images }),
    })
    expect(changed.issues.refused).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'posting',
          id: '1',
          code: 'EMBEDDED_IMAGE_REVIEW_REQUIRED',
        }),
      ])
    )
  })
  it('내장 이미지가 없는 scene이어도 별도 원본 PNG를 검토하고 승인 전 적재하지 않는다', async () => {
    const emptyScene = { type: 'excalidraw', version: 2, elements: [], files: {} }
    const read: OpeningObjectReader = async (input) =>
      input.key === 'content_data/a.json'
        ? Buffer.from(JSON.stringify(emptyScene))
        : readObject(input)
    const prepared = await prepareOpeningCustomer(fakeSource().client, read, {
      brandId: '9',
      webOrigin: 'https://opening.work',
    })
    const resource = prepared.postings.find((item) => item.sourcePostingId === '1')?.content
      .resources['70']
    expect(resource?.scene?.files).toEqual({})
    expect(prepared.manifest.manualReviewImages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sha256: resource?.sha256,
          owners: expect.arrayContaining(['posting:1']),
        }),
      ])
    )
    const images = prepared.manifest.manualReviewImages
      .map((image) => image.sha256)
      .filter((sha) => sha !== resource?.sha256)
    const report = await importSet(fakeDb().db, prepared, true, undefined, {
      review: reviewFile({ images }),
    })
    expect(report.issues.refused).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'posting', id: '1', code: 'IMAGE_REVIEW_REQUIRED' }),
      ])
    )
    const approved = await importSet(fakeDb().db, prepared, true)
    expect(approved.issues.refused).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'posting', id: '1' })])
    )
  })

  it('내장 이미지가 있는 scene은 원본 PNG 승인만으로 준비하거나 적재할 수 없다', async () => {
    const prepared = await prepareOpeningCustomer(
      fakeSource().client,
      async (input) =>
        ['content_data/a.json', 'content_data/c.json'].includes(input.key)
          ? Buffer.from(JSON.stringify(scene()))
          : readObject(input),
      { brandId: '9', webOrigin: 'https://opening.work' }
    )
    expect(prepared.manifest.postings.find((item) => item.id === '1')).toMatchObject({
      status: 'held',
      reasons: expect.arrayContaining(['EMBEDDED_IMAGE_REVIEW_REQUIRED']),
    })
    expect(prepared.manifest.templates.find((item) => item.id === '40')).toMatchObject({
      status: 'held',
      reasons: expect.arrayContaining(['EMBEDDED_IMAGE_REVIEW_REQUIRED']),
    })
    const changed = await prepare()
    const embedded = await sanitizeScene(scene())
    changed.postings[0].content.resources['70'].scene = embedded
    changed.templates[0].resources['72'].scene = embedded
    const report = await importSet(fakeDb().db, changed, true)
    expect(report.issues.refused).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'posting',
          id: '1',
          code: 'EMBEDDED_IMAGE_REVIEW_REQUIRED',
        }),
        expect.objectContaining({
          kind: 'template',
          id: '40',
          code: 'EMBEDDED_IMAGE_REVIEW_REQUIRED',
        }),
      ])
    )
  })

  it('--apply는 검토 파일 없이 시작하지 않는다', async () => {
    const prepared = await prepare()
    await expect(
      importSet(fakeDb().db, prepared, true, undefined, { review: undefined })
    ).rejects.toThrow('REVIEW_FILE_REQUIRED')
  })

  it('검토 안 된 이미지가 있는 항목만 거부하고 나머지는 적재한다', async () => {
    const prepared = await prepare()
    const refusedSha = prepared.manifest.manualReviewImages.find((image) =>
      image.owners.includes('posting:2')
    )?.sha256
    const onlyPosting1 = prepared.manifest.manualReviewImages
      .map((image) => image.sha256)
      .filter((sha) => sha !== refusedSha)
    const { db, postings, records } = fakeDb()
    const { objects, storage } = memoryStorage()
    const report = await importSet(db, prepared, true, storage, {
      review: reviewFile({ images: onlyPosting1 }),
    })
    expect(report.status).toBe('APPLIED_PARTIAL')
    expect(report.issues.refused.length).toBeGreaterThan(0)
    expect(report.issues.refused[0].code).toBe('IMAGE_REVIEW_REQUIRED')
    expect(postings.size + report.refused.postings).toBe(2)
    expect(records.size).toBeGreaterThan(0)
    expect(objects.size).toBe(report.assets.total)
  })

  it('dry-run은 검토 파일 없이도 거부될 항목 수를 보여 준다', async () => {
    const prepared = await prepare()
    const report = await importSet(fakeDb().db, prepared, false, undefined, { review: undefined })
    expect(report.status).toBe('PLANNED')
    expect(report.refused.postings).toBe(2)
    expect(safeMigrationSummary(report)).not.toHaveProperty('targetSpaceName')
  })

  it('packet의 고객과 --brand-id가 다르면 거부한다', async () => {
    const prepared = await prepare()
    await expect(
      runOpeningImport(fakeDb().db as unknown as FakeDb, prepared, {
        spaceId: 'space',
        brandId: '8',
        apply: false,
        readAsset: async () => new Uint8Array(),
      })
    ).rejects.toThrow('PACKET_BRAND_MISMATCH')
  })

  it('충돌 항목을 기록하고 --skip-conflicts면 그 항목만 빼고 진행한다', async () => {
    const first = await prepare()
    const { db, postings, positions } = fakeDb()
    await importSet(db, first, true)
    const changed = await prepare()
    changed.postings[0].posting.title = '수정된 합성 공고'
    changed.org.positions.push({ ...changed.org.positions[0], sourceId: '31', name: '새 직무' })

    const stopped = await importSet(db, changed, true)
    expect(stopped.status).toBe('CONFLICT_STOPPED')
    expect(stopped.issues.conflicts).toEqual([
      { kind: 'posting', id: '1', code: 'Migration source conflict' },
    ])
    expect(positions.size).toBe(1)

    const report = await importSet(db, changed, true, undefined, { skipConflicts: true })
    expect(report).toMatchObject({
      status: 'APPLIED_PARTIAL',
      positions: { created: 1, skipped: 1 },
      postings: { conflict: 1, skipped: 1 },
    })
    expect(positions.size).toBe(2)
    expect([...postings.values()][0].title).toBe('합성 공고 1')

    const root = mkdtempSync(join(tmpdir(), 'opening-issues-'))
    try {
      writeImportIssues(root, report.issues)
      expect(statSync(join(root, 'conflicts.json')).mode & 0o777).toBe(0o600)
      writeImportIssues(root, { conflicts: [], refused: [] })
      expect(readdirSync(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('템플릿 트랜잭션은 60초 제한을 쓴다', async () => {
    const prepared = await prepare()
    const { db, transactionOptions } = fakeDb()
    await importSet(db, prepared, true)
    expect(transactionOptions).toContainEqual({ timeout: 60_000 })
    expect(transactionOptions.filter(Boolean)).toHaveLength(3)
  })

  it('packet의 scene에 삭제 요소·customData·미사용 파일이 있으면 거부한다', async () => {
    const { postings } = await prepare()
    const parse = (edit: (scene: Record<string, unknown>) => void) => {
      const packet = JSON.parse(JSON.stringify(postings[0]))
      edit(packet.content.resources['70'].scene)
      return postingPacketSchema.safeParse(packet).success
    }
    expect(parse(() => undefined)).toBe(true)
    expect(parse((scene) => (scene.elements as unknown[]).push({ id: 'x', isDeleted: true }))).toBe(
      false
    )
    expect(parse((scene) => (scene.elements as unknown[]).push({ customData: {} }))).toBe(false)
    expect(
      parse((scene) =>
        Object.assign(scene.files as object, {
          y: { id: 'y', mimeType: 'image/png', dataURL: 'x' },
        })
      )
    ).toBe(false)
    expect(parse((scene) => Object.assign(scene, { appState: { collaborators: [] } }))).toBe(false)
  })
})

describe('대상 환경 가드', () => {
  const prod = 'duyteczbadcuvfeawlzu'
  const direct = `postgresql://postgres:p@db.${prod}.supabase.co:5432/postgres`
  const pooler = `postgresql://postgres.${prod}:p@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`
  const dev = 'postgresql://postgres.tumkfkfgzkmisguyaghn:p@aws-1.pooler.supabase.com:5432/postgres'
  const devStorage = 'https://tumkfkfgzkmisguyaghn.supabase.co'
  const prodStorage = `https://${prod}.supabase.co`
  const scope = { brandId: '9', targetSpace: 's1' }

  it.each([
    ['direct', { DATABASE_URL: direct, NEXT_PUBLIC_SUPABASE_URL: prodStorage }],
    ['pooler 사용자명', { DATABASE_URL: pooler, NEXT_PUBLIC_SUPABASE_URL: prodStorage }],
    ['DIRECT_URL만', { DIRECT_URL: pooler, NEXT_PUBLIC_SUPABASE_URL: prodStorage }],
  ])('운영(%s)은 <brandId>:<spaceId> 확인값이 있어야 한다', (_name, env) => {
    expect(() => assertImportTarget(env, scope)).toThrow('PRODUCTION_CONFIRM_REQUIRED')
    expect(() => assertImportTarget(env, { ...scope, confirmProd: 's1' })).toThrow(
      'PRODUCTION_CONFIRM_REQUIRED'
    )
    expect(() => assertImportTarget(env, { ...scope, confirmProd: '8:s1' })).toThrow(
      'PRODUCTION_CONFIRM_REQUIRED'
    )
    expect(assertImportTarget(env, { ...scope, confirmProd: '9:s1' })).toBe('production')
  })

  it('개발로 확인되지 않는 대상은 운영처럼 확인을 요구한다', () => {
    const env = { DATABASE_URL: 'postgresql://u:p@db.unknown.example/postgres' }
    expect(() => assertImportTarget(env, scope)).toThrow('PRODUCTION_CONFIRM_REQUIRED')
    expect(assertImportTarget(env, { ...scope, confirmProd: '9:s1' })).toBe('unidentified')
  })

  it('DB와 Storage 프로젝트가 다르면 확인값이 있어도 거부한다', () => {
    expect(() =>
      assertImportTarget(
        { DATABASE_URL: dev, NEXT_PUBLIC_SUPABASE_URL: prodStorage },
        { ...scope, confirmProd: '9:s1' }
      )
    ).toThrow('TARGET_PROJECT_MISMATCH')
  })

  it('개발 프로젝트로 확인되면 통과한다', () => {
    expect(
      assertImportTarget({ DATABASE_URL: dev, NEXT_PUBLIC_SUPABASE_URL: devStorage }, scope)
    ).toBe('development')
  })

  it.each([
    [
      '비밀번호',
      `postgresql://postgres.${prod}:tumkfkfgzkmisguyaghn@aws-1.pooler.supabase.com:5432/postgres`,
    ],
    ['쿼리', `${pooler}?application_name=tumkfkfgzkmisguyaghn`],
    ['host 쿼리 덮어쓰기', `${dev}?host=db.${prod}.supabase.co`],
    ['user 쿼리 덮어쓰기', `${dev}?user=postgres.${prod}`],
  ])(
    'DB %s에 개발 ref가 있어도 실제 개발 프로젝트가 아니면 개발로 취급하지 않는다',
    (_name, db) => {
      expect(() =>
        assertImportTarget({ DATABASE_URL: db, NEXT_PUBLIC_SUPABASE_URL: devStorage }, scope)
      ).toThrow()
    }
  )

  it('Storage URL의 경로에 개발 ref가 있어도 개발 프로젝트로 취급하지 않는다', () => {
    expect(() =>
      assertImportTarget(
        {
          DATABASE_URL: dev,
          NEXT_PUBLIC_SUPABASE_URL: `https://${prod}.supabase.co/tumkfkfgzkmisguyaghn`,
        },
        scope
      )
    ).toThrow()
  })

  it('실제 DB host가 아닌 곳의 개발 ref만으로 개발 프로젝트를 식별하지 않는다', () => {
    expect(() =>
      assertImportTarget(
        {
          DATABASE_URL: 'postgresql://postgres.tumkfkfgzkmisguyaghn:p@other.example/postgres',
          NEXT_PUBLIC_SUPABASE_URL: devStorage,
        },
        scope
      )
    ).toThrow()
  })

  it('연결 대상 덮어쓰기 쿼리는 운영 확인값이 있어도 거부한다', () => {
    expect(() =>
      assertImportTarget(
        { DATABASE_URL: `${dev}?host=db.${prod}.supabase.co` },
        { ...scope, confirmProd: '9:s1' }
      )
    ).toThrow('TARGET_PROJECT_MISMATCH')
  })
  it('미확인 프로젝트도 DB와 Storage의 ref가 다르면 운영 확인값이 있어도 거부한다', () => {
    const database = 'postgresql://postgres:p@db.aaaaaaaaaaaaaaaaaaaa.supabase.co:5432/postgres'
    const storage = 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co'
    expect(() =>
      assertImportTarget(
        { DATABASE_URL: database, NEXT_PUBLIC_SUPABASE_URL: storage },
        { ...scope, confirmProd: '9:s1' }
      )
    ).toThrow('TARGET_PROJECT_MISMATCH')
  })

  it('동일한 미확인 프로젝트는 운영 확인값을 요구한다', () => {
    const env = {
      DATABASE_URL: 'postgresql://postgres:p@db.aaaaaaaaaaaaaaaaaaaa.supabase.co:5432/postgres',
      NEXT_PUBLIC_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
    }
    expect(() => assertImportTarget(env, scope)).toThrow('PRODUCTION_CONFIRM_REQUIRED')
    expect(assertImportTarget(env, { ...scope, confirmProd: '9:s1' })).toBe('unidentified')
  })
})
