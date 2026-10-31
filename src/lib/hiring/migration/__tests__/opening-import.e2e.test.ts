/**
 * Opening 비PII 적재 실 DB 검증 — dev DB 전용. 임시 Space에 합성 packet을 넣고 전부 지운다.
 * 실행: npx jest -c jest.config.e2e.ts src/lib/hiring/migration/__tests__/opening-import.e2e.test.ts
 */
import { createHash, randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { prisma } from '@/lib/prisma'
import { runOpeningImport, type TargetStorage } from '../opening-import'
import type { OrgPacket, PostingPacket, TemplatePacket } from '../opening-packet'

config({ path: '.env.local', override: false })

const DEV_REF = 'tumkfkfgzkmisguyaghn'
const at = new Date().toISOString()
const token = randomUUID().slice(0, 8)
// 다른 실행·실데이터와 겹치지 않는 합성 원본 id.
const base = String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, '0')
const sourceId = (n: number) => `9${base}${n}`
const space = `opening-e2e-${token}`
const user = randomUUID()
// 적재는 packet의 sha256만 검증하므로 디코딩 가능한 이미지일 필요가 없다.
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const asset = {
  ref: 'b'.repeat(64),
  sha256: createHash('sha256').update(png).digest('hex'),
  sizeBytes: png.byteLength,
  mimeType: 'image/png' as const,
}

function packets() {
  const org: OrgPacket = {
    sourceSpaceId: sourceId(1),
    sourceSnapshotAt: at,
    stores: [
      {
        sourceId: sourceId(2),
        name: '합성 매장',
        roadAddress: '서울 합성로 1',
        isActive: true,
        createdAt: at,
        updatedAt: at,
      },
    ],
    positions: [
      {
        sourceId: sourceId(3),
        name: '합성 직무',
        category: '서비스',
        isActive: true,
        createdAt: at,
        updatedAt: at,
      },
    ],
  }
  const posting: PostingPacket = {
    sourceSpaceId: sourceId(1),
    sourcePostingId: sourceId(4),
    sourceSnapshotAt: at,
    posting: {
      uuid: `e2e${token}`,
      title: '합성 공고',
      status: 1,
      createdAt: at,
      updatedAt: at,
      closingDate: null,
      applicationEntries: [
        { key: 'name', type: 'string', label: '이름', required: true },
        { key: 'phone', type: 'phone', label: '연락처', required: true },
      ],
    },
    positions: [
      {
        sourceId: sourceId(5),
        sourcePositionId: sourceId(3),
        fields: { name: '합성 직무', payFrequency: 'HOURLY', payAmount: 10030 },
        createdAt: at,
        updatedAt: at,
      },
    ],
    sourceStoreIds: [sourceId(2)],
    historicalStoreIds: [],
    content: {
      detail: [
        { type: 'posting_title', enabled: true },
        { type: 'posting_positions', enabled: true },
        { type: 'posting_stores', enabled: true },
        { type: 'image', enabled: true, image_key: asset.ref },
      ],
      images: { 'index:3': { ...asset } },
      resources: {},
      postingTitle: '합성 제목',
      storesText: '합성 매장\n서울 합성로 1',
      positionsVerified: true,
      originalApplyUrl: `https://opening.work/p/e2e${token}`,
    },
  }
  const template: TemplatePacket = {
    sourceSpaceId: sourceId(1),
    sourceTemplateId: sourceId(6),
    sourceSnapshotAt: at,
    sourceWebOrigin: 'https://opening.work',
    name: '합성 템플릿',
    createdAt: at,
    updatedAt: at,
    detail: [{ type: 'image', enabled: true, image_key: asset.ref }],
    images: { 'index:0': { ...asset } },
    resources: {},
  }
  return { org, postings: [posting], templates: [template] }
}

const objects = new Map<string, Uint8Array>()
const storage: TargetStorage = {
  read: async (path) => objects.get(path) ?? null,
  write: async (path, bytes) => void objects.set(path, bytes),
}
const run = (set: ReturnType<typeof packets>, apply: boolean) =>
  runOpeningImport(prisma, set, {
    spaceId: space,
    brandId: sourceId(1),
    apply,
    storage,
    review: {
      sourceSpaceId: sourceId(1),
      reviewer: '합성 검토자',
      reviewedAt: '2026-11-01',
      items: [],
      images: [asset.sha256],
    },
    readAsset: async () => png,
  })

describe('Opening 비PII 적재 (dev DB)', () => {
  beforeAll(async () => {
    const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''
    // 합성 자료라도 다른 환경에는 쓰지 않는다.
    if (!url.includes(DEV_REF)) throw Error('dev DB에서만 실행한다')
    // 로컬 env에 v1 키가 없을 수 있어 이 프로세스에만 합성 키를 둔다.
    process.env.ENCRYPTION_KEY_V1 ??= 'd'.repeat(64)
    await prisma.user.create({ data: { id: user, email: `${token}@opening-e2e.test` } })
    await prisma.space.create({
      data: {
        id: space,
        name: 'opening-e2e',
        members: { create: { userId: user, role: 'OWNER' } },
      },
    })
  })

  afterAll(async () => {
    // 원장과 공고 직무는 Space cascade가 없어 먼저 지운다.
    await prisma.hiringMigrationRecord.deleteMany({ where: { spaceId: space } })
    await prisma.hiringPosting.deleteMany({ where: { spaceId: space } })
    await prisma.space.deleteMany({ where: { id: space } })
    await prisma.user.deleteMany({ where: { id: user } })
    const left = await prisma.hiringStore.count({ where: { spaceId: space } })
    await prisma.$disconnect()
    expect(left).toBe(0)
  })

  it('dry-run → apply → 재실행 → 원본 변경·고객 수정 충돌을 실제 원장으로 확인한다', async () => {
    const planned = await run(packets(), false)
    expect(planned).toMatchObject({
      status: 'PLANNED',
      stores: { created: 1 },
      positions: { created: 1 },
      templates: { created: 1 },
      postings: { created: 1 },
    })
    expect(await prisma.hiringMigrationRecord.count({ where: { spaceId: space } })).toBe(0)
    expect(objects.size).toBe(0)

    const applied = await run(packets(), true)
    expect(applied).toMatchObject({
      status: 'APPLIED',
      targetSpaceName: 'opening-e2e',
      postings: { created: 1, conflict: 0 },
    })
    expect(objects.size).toBe(1)
    const posting = await prisma.hiringPosting.findFirstOrThrow({
      where: { spaceId: space },
      include: { positions: true, stores: true, contents: true },
    })
    expect(posting).toMatchObject({
      status: 'DRAFT',
      notificationEnabled: false,
      publishedAt: null,
      authorUserId: null,
      managerNameEnc: null,
      managerPhoneEnc: null,
    })
    const store = await prisma.hiringStore.findFirstOrThrow({ where: { spaceId: space } })
    const position = await prisma.hiringPosition.findFirstOrThrow({ where: { spaceId: space } })
    expect(posting.stores.map((link) => link.storeId)).toEqual([store.id])
    expect(posting.positions[0].positionId).toBe(position.id)
    expect(posting.contents.find((c) => c.contentType === 'image')?.imagePath).toMatch(
      new RegExp(`^${space}/migration/`)
    )
    const template = await prisma.hiringDetailTemplate.findFirstOrThrow({
      where: { spaceId: space },
      include: { contents: true },
    })
    expect(template).toMatchObject({ isSample: false, name: '합성 템플릿' })
    expect(template.contents).toHaveLength(1)
    const record = await prisma.hiringMigrationRecord.findFirstOrThrow({
      where: { spaceId: space, targetModel: 'HiringPosting' },
    })
    expect(record.transformVersion).toBe('posting-v2')

    const again = await run(packets(), true)
    expect(again).toMatchObject({
      status: 'APPLIED',
      stores: { created: 0, skipped: 1 },
      positions: { skipped: 1 },
      templates: { skipped: 1 },
      postings: { created: 0, skipped: 1 },
    })
    expect(await prisma.hiringPosting.count({ where: { spaceId: space } })).toBe(1)

    const changed = packets()
    changed.postings[0].posting.title = '원본에서 바뀐 합성 공고'
    expect(await run(changed, true)).toMatchObject({
      status: 'CONFLICT_STOPPED',
      postings: { conflict: 1 },
    })

    await prisma.hiringPosting.update({ where: { id: posting.id }, data: { title: '고객 수정' } })
    expect(await run(packets(), true)).toMatchObject({
      status: 'CONFLICT_STOPPED',
      postings: { conflict: 1 },
    })
  })
})
