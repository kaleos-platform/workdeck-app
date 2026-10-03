// 검증 DB 전용. 원본 조회·파일 복사·알림을 실행하지 않고 검증된 입력만 적재한다.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { PrismaClient } from '@/generated/prisma/client'
import { buildApplicationPii, type ApplicationEntryValue } from '@/lib/hiring/pii'
import { openingApplicationSnapshotSchema, projectApplicationHistory } from './application-history'
import {
  decodeMigrationSnapshot,
  importMigrationRecord,
  migrationHash,
  migrationSourceRef,
} from './ledger'

const mapping = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  evidenceRef: z.string().trim().min(1),
})
const inputSchema = z.object({
  sourceSpaceId: z.string().regex(/^[1-9]\d*$/),
  sourcePostingId: z.string().regex(/^[1-9]\d*$/),
  spaceId: z.string().min(1),
  postingId: z.string().min(1),
  sourceSnapshotAt: z.iso.datetime(),
  snapshot: z.unknown(),
  state: z.object({
    sourceStatus: z.number().int(),
    sourceStage: z.number().int(),
    sourceHiringStage: z.number().int(),
    stage: z.enum(['HIRING', 'ACCEPTED', 'REJECTED']),
    hiringStage: z.enum(['APPLIED', 'INTERVIEW', 'JOB_OFFER']),
    evidenceRef: z.string().trim().min(1),
  }),
  pii: z.array(
    z.object({
      entryIndex: z.number().int().nonnegative(),
      targetKey: z.enum(['name', 'phone', 'email', 'address']),
      evidenceRef: z.string().trim().min(1),
    })
  ),
  position: mapping.nullable(),
  stores: z.array(mapping),
  files: z.array(
    z.object({
      id: z.string().min(1),
      fileName: z.string().min(1),
      mimeType: z.string().min(1),
      path: z.string().min(1),
      bytes: z
        .number()
        .int()
        .positive()
        .max(20 * 1024 * 1024),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      sourceRef: z.string().min(1),
      verified: z.literal(true),
    })
  ),
})
export type OpeningApplicationImport = z.input<typeof inputSchema>
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const graph = {
  files: { orderBy: { id: 'asc' as const } },
  stores: { orderBy: { storeId: 'asc' as const } },
}
const postingGraph = {
  positions: { orderBy: { id: 'asc' as const } },
  stores: { orderBy: { storeId: 'asc' as const }, include: { store: true } },
  contents: { orderBy: { sortOrder: 'asc' as const } },
}
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

export async function importOpeningApplication(
  db: Pick<PrismaClient, '$transaction'>,
  raw: OpeningApplicationImport
) {
  const parsed = inputSchema.safeParse(raw)
  const snapshotResult = openingApplicationSnapshotSchema.safeParse(raw.snapshot)
  if (
    !parsed.success ||
    !snapshotResult.success ||
    !object(raw.snapshot) ||
    !object(raw.snapshot.application)
  )
    throw Error('Invalid application migration packet')
  const input = parsed.data
  const snapshot = snapshotResult.data
  const app = snapshot.application
  const original = raw.snapshot.application
  const operational = z
    .object({
      memo: z.string().optional(),
      referrer: z.string().optional(),
      duplicated: z.boolean().optional(),
      direct_registration: z.boolean().optional(),
    })
    .safeParse(original)
  if (!operational.success) throw Error('Invalid application operational fields')
  if (
    original.brand_id !== input.sourceSpaceId ||
    original.posting_id !== input.sourcePostingId ||
    original.posting_position_id !== (input.position?.sourceId ?? null)
  )
    throw Error('Migration source relation conflict')
  if (
    !/^[1-9]\d*$/.test(app.id) ||
    input.state.sourceStatus !== app.status ||
    input.state.sourceStage !== app.stage ||
    input.state.sourceHiringStage !== app.hiring_stage
  )
    throw Error('Migration state evidence required')
  if (![0, 1].includes(app.status) || (app.status === 0 && !app.deleted_at))
    throw Error('Deleted application policy required')
  if (
    new Set(input.stores.map((store) => store.sourceId)).size !== input.stores.length ||
    new Set(input.stores.map((store) => store.targetId)).size !== input.stores.length ||
    new Set(input.files.map((file) => file.id)).size !== input.files.length ||
    new Set(input.pii.map((entry) => entry.targetKey)).size !== input.pii.length ||
    new Set(input.pii.map((entry) => entry.entryIndex)).size !== input.pii.length
  )
    throw Error('Duplicate migration relation')
  const rawStoreIds = raw.snapshot.sourceStoreIds
  if (
    !Array.isArray(rawStoreIds) ||
    rawStoreIds.some((id) => typeof id !== 'string') ||
    migrationHash([...rawStoreIds].sort()) !==
      migrationHash(input.stores.map((store) => store.sourceId).sort())
  )
    throw Error('Migration store mapping required')
  const piiEntries: ApplicationEntryValue[] = input.pii.map((decision) => {
    const entry = app.application_entries[decision.entryIndex]
    if (!object(entry) || (entry.value != null && typeof entry.value !== 'string'))
      throw Error('Migration PII mapping invalid')
    return { key: decision.targetKey, type: 'string', value: entry.value ?? null }
  })
  // 명시적 표준 PII도 매핑에서 빠뜨려 목록·검색 정보가 소실되는 것을 막는다.
  app.application_entries.forEach((entry, index) => {
    if (
      object(entry) &&
      ['name', 'phone', 'email', 'address'].includes(String(entry.key)) &&
      !input.pii.some(
        (decision) => decision.entryIndex === index && decision.targetKey === entry.key
      )
    )
      throw Error('Migration PII mapping required')
  })
  for (const file of input.files) {
    const expectedPath = `${input.spaceId}/migration/${createHash('sha256').update(file.sourceRef).digest('hex')}/${file.sha256}`
    if (file.path !== expectedPath) throw Error('Migration file path conflict')
    const mappings = snapshot.fileMappings.filter((item) => item.targetFileId === file.id)
    if (
      mappings.length !== 1 ||
      mappings[0].sha256 !== file.sha256 ||
      mappings[0].sizeBytes !== file.bytes ||
      mappings[0].verified !== true
    )
      throw Error('Migration file evidence required')
  }
  const view = projectApplicationHistory(snapshot, {
    spaceId: input.spaceId,
    applicationId: 'pending',
    sourceSnapshotAt: input.sourceSnapshotAt,
    files: input.files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      sizeBytes: file.bytes,
      spaceId: input.spaceId,
      applicationId: 'pending',
    })),
  })
  if (
    !view ||
    view.entries.some((entry) => entry.kind === 'files' && entry.unresolvedCount > 0) ||
    view.entries.flatMap((entry) => (entry.kind === 'files' ? entry.files : [])).length !==
      input.files.length ||
    snapshot.fileMappings.length !== input.files.length
  )
    throw Error('Migration file mapping incomplete')
  const pii = buildApplicationPii(piiEntries)
  const { snapshot: _snapshot, ...decisions } = input
  const rawOnlyEntryCount = app.application_entries.length - input.pii.length
  void _snapshot
  return db.$transaction(async (tx) => {
    const parentRecord = await tx.hiringMigrationRecord.findUnique({
      where: {
        sourceRef: migrationSourceRef({
          sourceSystem: 'opening.work',
          sourceTable: 'posting',
          sourceId: input.sourcePostingId,
          occurrence: '0',
        }),
      },
    })
    if (
      !parentRecord ||
      parentRecord.spaceId !== input.spaceId ||
      parentRecord.targetModel !== 'HiringPosting' ||
      parentRecord.targetId !== input.postingId
    )
      throw Error('Migration posting mapping required')
    const parentSnapshot = decodeMigrationSnapshot(parentRecord)
    if (
      !object(parentSnapshot) ||
      parentSnapshot.sourceSpaceId !== input.sourceSpaceId ||
      parentSnapshot.sourcePostingId !== input.sourcePostingId
    )
      throw Error('Migration posting source conflict')
    const posting = await tx.hiringPosting.findFirst({
      where: { id: input.postingId, spaceId: input.spaceId },
      include: postingGraph,
    })
    if (
      !posting ||
      posting.spaceId !== input.spaceId ||
      posting.status !== 'DRAFT' ||
      posting.notificationEnabled ||
      migrationHash(json(posting)) !== parentRecord.targetHash
    )
      throw Error('Migration posting target conflict')
    if (input.position) {
      const positionMap = object(parentRecord.metadata) ? parentRecord.metadata.positionMap : null
      if (
        !Array.isArray(positionMap) ||
        positionMap.filter(
          (item) =>
            object(item) &&
            item.sourceId === input.position!.sourceId &&
            item.targetId === input.position!.targetId
        ).length !== 1 ||
        !(await tx.hiringPostingPosition.findFirst({
          where: {
            id: input.position.targetId,
            postingId: input.postingId,
            spaceId: input.spaceId,
          },
          select: { id: true },
        }))
      )
        throw Error('Migration position outside posting')
    }
    const storeCount = await tx.hiringPostingStore.count({
      where: {
        postingId: input.postingId,
        storeId: { in: input.stores.map((store) => store.targetId) },
        store: { spaceId: input.spaceId },
      },
    })
    if (storeCount !== input.stores.length) throw Error('Migration store outside posting')
    const result = await importMigrationRecord(
      tx,
      {
        sourceSystem: 'opening.work',
        sourceTable: 'application',
        sourceId: app.id,
        occurrence: '0',
        spaceId: input.spaceId,
        sourceSnapshotAt: new Date(input.sourceSnapshotAt),
        transformVersion: 'application-v1',
        targetModel: 'HiringApplication',
        snapshot: { ...(raw.snapshot as Record<string, unknown>), importDecisions: decisions },
      },
      {
        create: (transaction) =>
          transaction.hiringApplication.create({
            data: {
              spaceId: input.spaceId,
              postingId: input.postingId,
              postingPositionId: input.position?.targetId ?? null,
              ...pii.columns,
              memo: operational.data.memo ?? null,
              referrer: operational.data.referrer ?? null,
              duplicated: operational.data.duplicated ?? false,
              directRegistration: operational.data.direct_registration ?? false,
              applicationEntries: [],
              stage: input.state.stage,
              hiringStage: input.state.hiringStage,
              privacyAgreedAt: app.required_privacy_agreed_at
                ? new Date(app.required_privacy_agreed_at)
                : null,
              canceledAt: app.cancelled_at ? new Date(app.cancelled_at) : null,
              deletedAt: app.deleted_at ? new Date(app.deleted_at) : null,
              createdAt: new Date(app.created_at),
              updatedAt: new Date(app.updated_at),
              files: {
                create: input.files.map((file) => ({
                  id: file.id,
                  spaceId: input.spaceId,
                  fileName: file.fileName,
                  filePath: file.path,
                  mimeType: file.mimeType,
                  sizeBytes: file.bytes,
                })),
              },
              stores: { create: input.stores.map((store) => ({ storeId: store.targetId })) },
            },
            include: graph,
          }),
        read: (transaction, id) =>
          transaction.hiringApplication.findUnique({ where: { id }, include: graph }),
        snapshot: json,
      }
    )
    return { ...result, rawOnlyEntryCount, readyForCutover: false as const }
  })
}
