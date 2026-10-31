/** @jest-environment node */
import { createHash } from 'node:crypto'
import type { HiringMigrationRecord } from '@/generated/prisma/client'
import { decodeMigrationSnapshot, migrationSourceRef } from '../ledger'
import { assertImportTarget, runOpeningImport, type TargetStorage } from '../opening-import'
import {
  isInMigrationWindow,
  migrationWindowStart,
  scanContacts,
  type PostingPacket,
} from '../opening-packet'
import {
  prepareOpeningCustomer,
  type OpeningObjectReader,
  type OpeningSourceClient,
} from '../opening-prepare'

const snapshotAt = new Date('2026-10-31T03:00:00.000Z')
const recent = new Date('2026-09-01T00:00:00.000Z')
const old = new Date('2024-01-01T00:00:00.000Z')
const png = (seed: number) =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1])

const form = [
  { key: 'name', type: 'string', label: '이름', required: true },
  { key: 'phone', type: 'phone', label: '연락처', required: true },
]
const scene = (text = '합성 안내') => ({
  type: 'excalidraw',
  version: 2,
  elements: [{ id: 'a', type: 'text', text }],
  appState: { viewBackgroundColor: '#ffffff' },
  // base64 안의 숫자열은 전화번호로 세지 않아야 한다.
  files: { f: { dataURL: 'data:image/png;base64,MDEwMTIzNDU2Nzg=01012345678' } },
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
  return { file_key, status: 1, target_type, storage_type: 's3', storage: 'bucket' }
}

function fakeSource(rows = sourceRows()) {
  const queries: string[] = []
  const client: OpeningSourceClient = {
    query: async (sql) => {
      queries.push(sql)
      const table: [RegExp, unknown[]][] = [
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
        [/FROM file/, rows.files],
      ]
      return { rows: table.find(([pattern]) => pattern.test(sql))?.[1] ?? [] }
    },
  }
  return { client, queries }
}
const readObject: OpeningObjectReader = async ({ key }) => {
  if (key === 'content_data/a.json') return Buffer.from(JSON.stringify(scene()))
  if (key === 'content_data/b.json')
    return Buffer.from(JSON.stringify(scene('담당 010-1234-5678 / hr@synthetic.test')))
  if (key === 'content_data/c.json') return Buffer.from(JSON.stringify(scene()))
  return png([...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 200)
}
const prepare = (rows = sourceRows()) =>
  prepareOpeningCustomer(fakeSource(rows).client, readObject, {
    brandId: '9',
    webOrigin: 'https://opening.work',
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
  const db = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    space: { findUnique: async () => ({ id: 'space' }) },
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
  return { db, records, stores, positions, postings, templates }
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

async function importSet(
  db: ReturnType<typeof fakeDb>['db'],
  prepared: Awaited<ReturnType<typeof prepare>>,
  apply: boolean,
  storage = memoryStorage().storage
) {
  return runOpeningImport(db as unknown as FakeDb, prepared, {
    spaceId: 'space',
    apply,
    storage,
    readAsset: async (sha256) => prepared.assets.get(sha256) as Uint8Array,
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
    ['문의 010-1234-5678', 1, 0],
    ['010 1234 5678', 1, 0],
    ['01012345678', 1, 0],
    ['+82 10-1234-5678', 1, 0],
    ['0507-1234-5678', 1, 0],
    ['02-123-4567', 1, 0],
    ['hr.team+a@synthetic.co.kr', 0, 1],
    ['a'.repeat(4) + '01012345678' + 'b'.repeat(4), 0, 0],
    ['2026-10-31T03:00:00.000Z', 0, 0],
    ['시급 10,030원', 0, 0],
  ])('%s', (value, phone, email) => {
    expect(scanContacts({ nested: [value] })).toEqual({ phone, email })
  })

  it('이미지 data URL은 검사하지 않는다', () => {
    expect(scanContacts(scene())).toEqual({ phone: 0, email: 0 })
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
    expect(summary.postings).toMatchObject({ total: 7, included: 2, held: 3, excluded: 2 })
    expect(summary.postings.reasons).toEqual({
      HELD_CONTACT_PATTERN: 2,
      CONTENT_UNSUPPORTED_ATTRIBUTE: 1,
      OUT_OF_WINDOW: 1,
      DELETED: 1,
    })
    expect(summary.updatedOnly).toEqual({ count: 1, byDate: { '2026-03-02': 1 } })
    expect(summary.contactHits).toMatchObject({ phone: 2, email: 1, postingsHit: 2 })
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

  it('다른 고객 소유 content를 쓰는 공고는 보류한다', async () => {
    const rows = sourceRows()
    rows.contents[0].owner_brand_id = '8'
    const { manifest } = await prepare(rows)
    expect(manifest.postings.find((p) => p.id === '1')?.reasons).toEqual([
      'RESOURCE_SCOPE_MISMATCH',
    ])
  })

  it('SVG 등 비이미지 자산은 복사하지 않고 보류한다', async () => {
    const { manifest } = await prepareOpeningCustomer(
      fakeSource().client,
      async (object) =>
        object.key.endsWith('.json')
          ? readObject(object)
          : Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
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
        apply: true,
        readAsset: async () => new Uint8Array(),
      })
    ).rejects.toThrow('TARGET_STORAGE_REQUIRED')
  })
})

describe('대상 환경 가드', () => {
  const prod = 'duyteczbadcuvfeawlzu'
  const direct = `postgresql://postgres:p@db.${prod}.supabase.co:5432/postgres`
  const pooler = `postgresql://postgres.${prod}:p@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`
  const dev = 'postgresql://postgres.tumkfkfgzkmisguyaghn:p@aws-1.pooler.supabase.com:5432/postgres'
  const prodStorage = `https://${prod}.supabase.co`

  it.each([
    ['direct', { DATABASE_URL: direct, NEXT_PUBLIC_SUPABASE_URL: prodStorage }],
    ['pooler 사용자명', { DATABASE_URL: pooler, NEXT_PUBLIC_SUPABASE_URL: prodStorage }],
    ['DIRECT_URL만', { DIRECT_URL: pooler, NEXT_PUBLIC_SUPABASE_URL: prodStorage }],
  ])('운영(%s)은 확인값 없이 거부한다', (_name, env) => {
    expect(() => assertImportTarget(env, { targetSpace: 's1' })).toThrow(
      'PRODUCTION_CONFIRM_REQUIRED'
    )
    expect(() => assertImportTarget(env, { targetSpace: 's1', confirmProd: 's2' })).toThrow(
      'PRODUCTION_CONFIRM_REQUIRED'
    )
    expect(assertImportTarget(env, { targetSpace: 's1', confirmProd: 's1' })).toBe('production')
  })

  it('DB와 Storage 프로젝트가 다르면 거부한다', () => {
    expect(() =>
      assertImportTarget(
        { DATABASE_URL: dev, NEXT_PUBLIC_SUPABASE_URL: prodStorage },
        { targetSpace: 's1', confirmProd: 's1' }
      )
    ).toThrow('TARGET_PROJECT_MISMATCH')
  })

  it('개발 DB는 통과한다', () => {
    expect(assertImportTarget({ DATABASE_URL: dev }, { targetSpace: 's1' })).toBe('non-production')
  })
})
