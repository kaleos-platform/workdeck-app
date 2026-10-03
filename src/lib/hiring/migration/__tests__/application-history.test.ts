/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringApplication: { findFirst: jest.fn() },
    hiringMigrationRecord: { findFirst: jest.fn() },
  },
}))
jest.mock('../ledger', () => ({ decodeMigrationSnapshot: jest.fn() }))
import { prisma } from '@/lib/prisma'
import { decodeMigrationSnapshot } from '../ledger'
import { getApplicationHistory, projectApplicationHistory } from '../application-history'

const at = '2026-10-03T00:00:00.000Z'
const fixture = () => ({
  schemaVersion: 'opening-application-v1',
  application: {
    id: '1',
    application_entries: [
      { type: 'select', label: '<script>alert(1)</script>', value: 1, is_other: true },
      { type: 'string', label: '문자', value: '1' },
      { type: 'string', label: '빈값', value: '' },
      { type: 'string', label: 'null', value: null },
      { type: 'string', label: '누락' },
      { type: 'file', label: '이력서', value: ['private/key'] },
    ],
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
  entryInterpretation: [
    { index: 0, status: 'verified', evidenceRef: 'snapshot:1', verifiedLabels: ['추정금지'] },
  ],
  fileMappings: [
    {
      entryIndex: 5,
      sourceFileKey: 'private/key',
      targetFileId: 'f1',
      sha256: 'a'.repeat(64),
      sizeBytes: 10,
      verified: true,
    },
  ],
})
const files = [
  { id: 'f1', applicationId: 'app', spaceId: 'space', fileName: 'resume.pdf', sizeBytes: 10 },
]
const project = (snapshot: unknown, suppliedFiles = files) =>
  projectApplicationHistory(snapshot, {
    applicationId: 'app',
    spaceId: 'space',
    sourceSnapshotAt: at,
    files: suppliedFiles,
  })

it('원시 타입과 null/빈 문자열/누락을 구분하고 기타 표시를 추정하지 않는다', () => {
  const result = project(fixture())!
  expect(result.entries[0]).toMatchObject({
    interpretation: 'unresolved',
    otherMarker: 'true',
    value: { kind: 'scalar', value: 1 },
  })
  expect(result.entries[0]).not.toHaveProperty('verifiedLabels')
  expect(result.entries[1]).toMatchObject({ value: { kind: 'scalar', value: '1' } })
  expect(result.entries[2]).toMatchObject({ value: { kind: 'scalar', value: '' } })
  expect(result.entries[3]).toMatchObject({ value: { kind: 'scalar', value: null } })
  expect(result.entries[4]).toMatchObject({ value: { kind: 'missing' } })
  expect(result.entries[5]).toMatchObject({ files: [{ id: 'f1' }], unresolvedCount: 0 })
  expect(JSON.stringify(result)).not.toContain('private/key')
})
it('다른 지원서 파일 및 미검증/중복 대응은 연결하지 않는다', () => {
  expect(project(fixture(), [{ ...files[0], applicationId: 'other' }])!.entries[5]).toMatchObject({
    files: [],
    unresolvedCount: 1,
  })
  const source = fixture()
  source.fileMappings[0].verified = false
  expect(project(source)!.entries[5]).toMatchObject({ files: [], unresolvedCount: 1 })
  source.fileMappings[0].verified = true
  source.fileMappings.push({ ...source.fileMappings[0] })
  expect(project(source)!.entries[5]).toMatchObject({ files: [], unresolvedCount: 1 })
})
it('잘못된 버전/날짜/루트는 안전하게 거부한다', () => {
  expect(project({ ...fixture(), schemaVersion: 'unknown' })).toBeNull()
  const source = fixture()
  source.application.created_at = '2026-02-30T00:00:00.000Z'
  expect(project(source)).toBeNull()
  expect(project(null)).toBeNull()
})
beforeEach(() => jest.clearAllMocks())
it('소유 지원서를 먼저 확인하고 없으면 원장 조회와 복호화를 하지 않는다', async () => {
  jest.mocked(prisma.hiringApplication.findFirst).mockResolvedValue(null)
  expect(await getApplicationHistory('space', 'foreign')).toEqual({ status: 'absent' })
  expect(prisma.hiringApplication.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'foreign', spaceId: 'space', deletedAt: null } })
  )
  expect(prisma.hiringMigrationRecord.findFirst).not.toHaveBeenCalled()
  expect(decodeMigrationSnapshot).not.toHaveBeenCalled()
})
it('원장도 공간과 지원서로 제한하며 복호화 실패를 고정 결과로 반환한다', async () => {
  jest.mocked(prisma.hiringApplication.findFirst).mockResolvedValue({ id: 'app', files } as never)
  jest
    .mocked(prisma.hiringMigrationRecord.findFirst)
    .mockResolvedValue({ sourceSnapshotAt: new Date(at) } as never)
  jest.mocked(decodeMigrationSnapshot).mockImplementation(() => {
    throw new Error('sensitive source')
  })
  expect(await getApplicationHistory('space', 'app')).toEqual({ status: 'unavailable' })
  expect(prisma.hiringMigrationRecord.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { spaceId: 'space', targetModel: 'HiringApplication', targetId: 'app' },
    })
  )
})
it('snapshot이 없으면 복호화하지 않고 잘못된 snapshot은 원문을 반환하지 않는다', async () => {
  jest.mocked(prisma.hiringApplication.findFirst).mockResolvedValue({ id: 'app', files } as never)
  jest.mocked(prisma.hiringMigrationRecord.findFirst).mockResolvedValue(null)
  expect(await getApplicationHistory('space', 'app')).toEqual({ status: 'absent' })
  expect(decodeMigrationSnapshot).not.toHaveBeenCalled()
  jest
    .mocked(prisma.hiringMigrationRecord.findFirst)
    .mockResolvedValue({ sourceSnapshotAt: new Date(at) } as never)
  jest.mocked(decodeMigrationSnapshot).mockReturnValue({ secret: 'sensitive' })
  expect(await getApplicationHistory('space', 'app')).toEqual({ status: 'unavailable' })
})
it('파일 검증표시 누락과 크기·checksum 형식 불일치·다른 공간을 거부한다', () => {
  const source = fixture()
  const unverified = {
    ...source,
    fileMappings: source.fileMappings.map((mapping) =>
      Object.fromEntries(Object.entries(mapping).filter(([key]) => key !== 'verified'))
    ),
  }
  expect(project(unverified)!.entries[5]).toMatchObject({ files: [], unresolvedCount: 1 })
  source.fileMappings[0].sizeBytes = 11
  expect(project(source)!.entries[5]).toMatchObject({ files: [], unresolvedCount: 1 })
  source.fileMappings[0].sizeBytes = 10
  source.fileMappings[0].sha256 = 'wrong'
  expect(project(source)!.entries[5]).toMatchObject({ files: [], unresolvedCount: 1 })
  expect(project(fixture(), [{ ...files[0], spaceId: 'foreign' }])!.entries[5]).toMatchObject({
    files: [],
    unresolvedCount: 1,
  })
})
it('선택 라벨은 명시적 근거가 있을 때만 표시하고 원시 배열 타입을 보존한다', () => {
  const source = fixture()
  source.application.application_entries[0].is_other = false
  expect(project(source)!.entries[0]).toMatchObject({
    interpretation: 'verified',
    verifiedLabels: ['추정금지'],
  })
  source.entryInterpretation[0].evidenceRef = ''
  expect(project(source)!.entries[0]).toMatchObject({ interpretation: 'unresolved' })
  const arraySource = {
    ...source,
    application: {
      ...source.application,
      application_entries: [
        { type: 'multiselect', label: '배열', value: ['1', 1, null, false, ''] },
      ],
    },
  }
  expect(project(arraySource)!.entries[0]).toMatchObject({
    value: { kind: 'array', values: ['1', 1, null, false, ''] },
  })
})
it.each([{ value: null }, { value: '' }, { value: undefined }, { value: [] }])(
  '빈 파일 값 %j를 미해결 키로 세지 않는다',
  ({ value }) => {
    const source = fixture()
    const snapshot = {
      ...source,
      fileMappings: [],
      application: {
        ...source.application,
        application_entries: [{ type: 'file', ...(value === undefined ? {} : { value }) }],
      },
    }
    expect(project(snapshot)!.entries[0]).toMatchObject({
      kind: 'files',
      files: [],
      unresolvedCount: 0,
    })
  }
)
it.each([{ value: [''] }, { value: [null] }, { value: {} }, { value: 'source/missing' }])(
  '실제 또는 잘못된 파일 참조 %j는 미확정으로 유지한다',
  ({ value }) => {
    const source = fixture()
    const snapshot = {
      ...source,
      fileMappings: [],
      application: { ...source.application, application_entries: [{ type: 'file', value }] },
    }
    expect(project(snapshot)!.entries[0]).toMatchObject({
      kind: 'files',
      files: [],
      unresolvedCount: 1,
    })
  }
)
