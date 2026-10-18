/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
import type { PrismaClient } from '@/generated/prisma/client'
import { importOpeningApplication, type OpeningApplicationImport } from '../application-import'
import { migrationHash, migrationSourceRef } from '../ledger'
import { encryptPii } from '@/lib/del/encryption'
import { recoverOpeningApplication } from '../application-recovery'
import { auditMigrationRecords } from '../runtime-audit'
import { migrationAssetManifest } from '../asset-audit'
import { spawnSync } from 'node:child_process'
const at = '2026-10-03T00:00:00.000Z'
function input(): OpeningApplicationImport {
  return {
    sourceSpaceId: '1',
    sourcePostingId: '2',
    spaceId: 'space',
    postingId: 'post',
    sourceSnapshotAt: at,
    snapshot: {
      schemaVersion: 'opening-application-v1',
      application: {
        id: '3',
        brand_id: '1',
        posting_id: '2',
        posting_position_id: null,
        application_entries: [{ key: 'name', type: 'string', label: '이름', value: '합성 이름' }],
        status: 1,
        stage: 1,
        hiring_stage: 2,
        created_at: at,
        updated_at: at,
        required_privacy_agreed_at: at,
        optional_privacy_agreed_at: null,
        cancelled_at: null,
        deleted_at: null,
      },
      sourceStoreIds: [],
      entryInterpretation: [],
      fileMappings: [],
    },
    state: {
      sourceStatus: 1,
      sourceStage: 1,
      sourceHiringStage: 2,
      stage: 'HIRING',
      hiringStage: 'INTERVIEW',
      evidenceRef: 'review:1',
    },
    pii: [{ entryIndex: 0, targetKey: 'name', evidenceRef: 'review:name' }],
    position: null,
    stores: [],
    files: [],
  }
}
let parent: Record<string, unknown>
let application: Record<string, unknown> | null
let records: Record<string, unknown>[]
const tx = {
  hiringPosting: { findFirst: jest.fn() },
  hiringPostingPosition: { findFirst: jest.fn() },
  hiringPostingStore: { count: jest.fn() },
  hiringMigrationRecord: { findUnique: jest.fn(), create: jest.fn() },
  hiringApplication: { create: jest.fn(), findUnique: jest.fn() },
}
const db = { $transaction: jest.fn(async (fn) => fn(tx)) } as unknown as Pick<
  PrismaClient,
  '$transaction'
>
beforeEach(() => {
  jest.clearAllMocks()
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
  process.env.ENCRYPTION_KEY_V1 = 'd'.repeat(64) // v1 루트 — v0 키(ENCRYPTION_KEY)와 다른 값
  process.env.HIRING_HMAC_KEY = 'cd'.repeat(32)
  application = null
  records = []
  parent = {
    id: 'post',
    spaceId: 'space',
    status: 'DRAFT',
    notificationEnabled: false,
    positions: [],
    stores: [],
    contents: [],
  }
  const parentSnapshot = { sourceSpaceId: '1', sourcePostingId: '2' }
  const encrypted = encryptPii(JSON.stringify(parentSnapshot))
  tx.hiringPosting.findFirst.mockImplementation(async () => parent)
  tx.hiringMigrationRecord.findUnique.mockImplementation(async ({ where }) =>
    where.sourceRef ===
    migrationSourceRef({
      sourceSystem: 'opening.work',
      sourceTable: 'posting',
      sourceId: '2',
      occurrence: '0',
    })
      ? {
          spaceId: 'space',
          targetModel: 'HiringPosting',
          targetId: 'post',
          sourceHash: migrationHash(parentSnapshot),
          targetHash: migrationHash(parent),
          sourceSnapshotEnc: encrypted.encrypted,
          sourceSnapshotIv: encrypted.iv,
          metadata: { positionMap: [] },
        }
      : (records.find((r) => r.sourceRef === where.sourceRef) ?? null)
  )
  tx.hiringMigrationRecord.create.mockImplementation(async ({ data }) => {
    const record = { id: 'record', ...data }
    records.push(record)
    return record
  })
  tx.hiringApplication.create.mockImplementation(async ({ data }) => {
    application = { ...data, id: 'app', files: data.files.create, stores: data.stores.create }
    return application
  })
  tx.hiringApplication.findUnique.mockImplementation(async () => application)
  tx.hiringPostingStore.count.mockResolvedValue(0)
})
it('한 transaction에서 원문과 PII를 보존하고 재실행은 추가 생성하지 않는다', async () => {
  expect((await importOpeningApplication(db, input())).status).toBe('created')
  expect(application).toMatchObject({
    spaceId: 'space',
    postingId: 'post',
    stage: 'HIRING',
    hiringStage: 'INTERVIEW',
    applicationEntries: [],
  })
  expect(application?.nameEnc).not.toContain('합성 이름')
  expect((await importOpeningApplication(db, input())).status).toBe('existing')
  expect(tx.hiringApplication.create).toHaveBeenCalledTimes(1)
})

it.each(['v0', 'v1'])(
  '%s executor 원장에서 입력을 복구하고 재실행해도 추가 생성하지 않는다',
  async (version) => {
    process.env.ENCRYPTION_WRITE_VERSION = version
    const first = await importOpeningApplication(db, input())
    expect(
      auditMigrationRecords([first.record], { sourceSpaceId: '1', spaceId: 'space' })
    ).toMatchObject({
      checked: 1,
      integrityVerified: 1,
      recoveryFailed: 0,
      models: { HiringApplication: { checked: 1, integrityVerified: 1 } },
    })
    const recovered = recoverOpeningApplication(first.record, {
      sourceSpaceId: '1',
      spaceId: 'space',
    })
    expect(recovered).toEqual(input())
    expect((await importOpeningApplication(db, recovered)).status).toBe('existing')
    expect(tx.hiringApplication.create).toHaveBeenCalledTimes(1)
  }
)

it('다른 고객·변환 버전·원본 ID·snapshot 시각·손상을 복구하지 않는다', async () => {
  const { record } = await importOpeningApplication(db, input())
  for (const override of [
    { spaceId: 'other' },
    { transformVersion: 'unknown' },
    { targetModel: 'HiringPosting' },
    { sourceRef: '["opening.work","application","4","0"]' },
    { sourceSnapshotAt: new Date('2026-10-04T00:00:00Z') },
    { sourceHash: '0'.repeat(64) },
  ]) {
    expect(() =>
      recoverOpeningApplication(
        { ...record, ...override },
        { sourceSpaceId: '1', spaceId: 'space' }
      )
    ).toThrow(/^APPLICATION_RECOVERY_FAILED$/)
  }
  expect(() => recoverOpeningApplication(record, { sourceSpaceId: '2', spaceId: 'space' })).toThrow(
    /^APPLICATION_RECOVERY_FAILED$/
  )
})

it('공통 복구 CLI는 HMAC 키 없이 지원서 원장을 검사하고 집계만 출력한다', async () => {
  const { record } = await importOpeningApplication(db, input())
  const env = { ...process.env }
  delete env.HIRING_HMAC_KEY
  const result = spawnSync(
    process.execPath,
    ['scripts/audit-opening-recovery.mjs', '--source-space', '1', '--target-space', 'space'],
    { input: JSON.stringify(record), encoding: 'utf8', env }
  )
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    status: 'RECOVERABLE',
    writes: 0,
    applications: 1,
    files: 0,
    stores: 0,
  })
  expect(result.stdout + result.stderr).not.toContain('합성 이름')
})
it('대상 편집 충돌을 덮어쓰지 않는다', async () => {
  await importOpeningApplication(db, input())
  application!.memo = '고객 편집'
  await expect(importOpeningApplication(db, input())).rejects.toThrow('Migration target conflict')
})
it.each(['active', 'space', 'state', 'position'])(
  '%s가 불명확하면 생성하지 않는다',
  async (kind) => {
    const packet = input()
    if (kind === 'active') parent.status = 'ACTIVE'
    if (kind === 'space') parent.spaceId = 'foreign'
    if (kind === 'state') packet.state.sourceStage = 3
    if (kind === 'position')
      packet.position = { sourceId: '9', targetId: 'foreign', evidenceRef: 'review:p' }
    await expect(importOpeningApplication(db, packet)).rejects.toThrow()
    expect(tx.hiringApplication.create).not.toHaveBeenCalled()
  }
)
it('원문 전용 항목 수를 반환하고 전환 완료로 표시하지 않는다', async () => {
  const packet = input()
  const snapshot = packet.snapshot as { application: { application_entries: unknown[] } }
  snapshot.application.application_entries.push({
    type: 'select',
    label: '과거 질문',
    value: '원시 값',
    is_other: true,
  })
  const result = await importOpeningApplication(db, packet)
  expect(result.rawOnlyEntryCount).toBe(1)
  expect(result.readyForCutover).toBe(false)
})
it('원본 상태 근거와 다른 공간 원장을 차단한다', async () => {
  tx.hiringMigrationRecord.findUnique.mockResolvedValue({
    spaceId: 'other',
    targetModel: 'HiringPosting',
    targetId: 'post',
  })
  await expect(importOpeningApplication(db, input())).rejects.toThrow(
    'Migration posting mapping required'
  )
  expect(tx.hiringApplication.create).not.toHaveBeenCalled()
})
it('매장이 공고에 연결되지 않으면 적재하지 않는다', async () => {
  const packet = input()
  packet.stores = [{ sourceId: '4', targetId: 'store', evidenceRef: 'review:store' }]
  ;(packet.snapshot as Record<string, unknown>).sourceStoreIds = ['4']
  await expect(importOpeningApplication(db, packet)).rejects.toThrow(
    'Migration store outside posting'
  )
  expect(tx.hiringApplication.create).not.toHaveBeenCalled()
})
it('검증된 파일 대응은 연결하고 경로/checksum/검증표시 오류는 차단한다', async () => {
  const { createHash } = await import('node:crypto')
  const packet = input()
  const snapshot = packet.snapshot as {
    application: { application_entries: unknown[] }
    fileMappings: unknown[]
  }
  const sourceRef = 'opening.work:file:4'
  const sha256 = 'a'.repeat(64)
  snapshot.application.application_entries.push({
    type: 'file',
    label: '첨부',
    value: ['source/key'],
  })
  snapshot.fileMappings = [
    {
      entryIndex: 1,
      sourceFileKey: 'source/key',
      targetFileId: 'file',
      sha256,
      sizeBytes: 10,
      verified: true,
    },
  ]
  packet.files = [
    {
      id: 'file',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sourceRef,
      sha256,
      bytes: 10,
      verified: true,
      path: `space/migration/${createHash('sha256').update(sourceRef).digest('hex')}/${sha256}`,
    },
  ]
  const imported = await importOpeningApplication(db, packet)
  expect(imported.status).toBe('created')
  expect(
    recoverOpeningApplication(imported.record, { sourceSpaceId: '1', spaceId: 'space' })
  ).toEqual(packet)
  expect(migrationAssetManifest(imported.record, { sourceSpaceId: '1', spaceId: 'space' })).toEqual(
    [{ bucket: 'hiring-files', path: packet.files[0].path, sizeBytes: 10, sha256 }]
  )
  expect(application?.files).toEqual([
    expect.objectContaining({ id: 'file', spaceId: 'space', sizeBytes: 10 }),
  ])
  packet.files[0].path = 'foreign/file'
  await expect(importOpeningApplication(db, packet)).rejects.toThrow('Migration file path conflict')
})
it('첨부가 누락되면 부분 적재하지 않는다', async () => {
  const packet = input()
  const snapshot = packet.snapshot as { application: { application_entries: unknown[] } }
  snapshot.application.application_entries.push({ type: 'file', value: ['missing'] })
  await expect(importOpeningApplication(db, packet)).rejects.toThrow(
    'Migration file mapping incomplete'
  )
  expect(tx.hiringApplication.create).not.toHaveBeenCalled()
})
it('같은 원본 ID의 변경된 snapshot을 기존 행에 덮어쓰지 않는다', async () => {
  await importOpeningApplication(db, input())
  const packet = input()
  ;(packet.snapshot as Record<string, unknown>).additionalSourceNote = 'changed'
  await expect(importOpeningApplication(db, packet)).rejects.toThrow('Migration source conflict')
  expect(tx.hiringApplication.create).toHaveBeenCalledTimes(1)
})
it('삭제 시각 없는 비활성 지원서는 시각을 만들어 적재하지 않는다', async () => {
  const packet = input()
  ;(packet.snapshot as { application: { status: number } }).application.status = 0
  packet.state.sourceStatus = 0
  await expect(importOpeningApplication(db, packet)).rejects.toThrow(
    'Deleted application policy required'
  )
  expect(tx.hiringApplication.create).not.toHaveBeenCalled()
})
it.each([null, undefined])('선택 개인정보의 빈 값 %s는 enc=null로 보존한다', async (value) => {
  const packet = input()
  const snapshot = packet.snapshot as { application: { application_entries: unknown[] } }
  snapshot.application.application_entries.push({
    key: 'email',
    type: 'email',
    label: '이메일',
    ...(value === undefined ? {} : { value }),
  })
  packet.pii.push({ entryIndex: 1, targetKey: 'email', evidenceRef: 'review:email' })
  await expect(importOpeningApplication(db, packet)).resolves.toMatchObject({ status: 'created' })
  expect(application?.emailEnc).toBeNull()
})
it.each([{ value: [] }, { value: {} }])(
  '개인정보 배열·객체 %j는 자동 문자열 변환하지 않는다',
  async ({ value }) => {
    const packet = input()
    const snapshot = packet.snapshot as { application: { application_entries: unknown[] } }
    snapshot.application.application_entries.push({
      key: 'address',
      type: 'string',
      label: '주소',
      value,
    })
    packet.pii.push({ entryIndex: 1, targetKey: 'address', evidenceRef: 'review:address' })
    await expect(importOpeningApplication(db, packet)).rejects.toThrow(
      'Migration PII mapping invalid'
    )
    expect(tx.hiringApplication.create).not.toHaveBeenCalled()
  }
)
it.each([{ value: null }, { value: '' }, { value: undefined }, { value: [] }])(
  '빈 첨부 %j는 파일 0개로 적재한다',
  async ({ value }) => {
    const packet = input()
    const snapshot = packet.snapshot as { application: { application_entries: unknown[] } }
    snapshot.application.application_entries.push({
      type: 'file',
      label: '선택 첨부',
      ...(value === undefined ? {} : { value }),
    })
    await expect(importOpeningApplication(db, packet)).resolves.toMatchObject({ status: 'created' })
    expect(application?.files).toEqual([])
  }
)
