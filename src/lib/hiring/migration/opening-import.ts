import { randomUUID } from 'node:crypto'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { copyMigrationFile } from './file-copy'
import {
  findExistingMigrationRecord,
  importMigrationRecord,
  migrationSourceRef,
  type MigrationInput,
} from './ledger'
import {
  OPENING_TRANSFORM_VERSION,
  contactCount,
  isInMigrationWindow,
  orgPacketSchema,
  parseReviewFile,
  postingPacketSchema,
  reviewHash,
  scanContacts,
  templatePacketSchema,
  unreadImages,
  type OrgPacket,
  type PostingPacket,
  type ReviewApprovals,
} from './opening-packet'
import type { VerifiedContentImage } from './posting-content'
import { planOpeningPosting } from './posting-import'
import {
  findExistingOpeningTemplate,
  importOpeningTemplate,
  planOpeningTemplate,
  type OpeningTemplatePacket,
} from './template-import'

type Asset = PostingPacket['content']['images'][string]
export type AssetBinder = (asset: Asset) => Promise<VerifiedContentImage>
export type TargetStorage = {
  read: (path: string) => Promise<Uint8Array | null>
  write: (path: string, bytes: Uint8Array, mimeType: string) => Promise<void>
}
export type PacketSet = { org: unknown; templates: unknown[]; postings: unknown[] }
type Db = Pick<
  PrismaClient,
  | '$transaction'
  | 'space'
  | 'spaceMember'
  | 'hiringMigrationRecord'
  | 'hiringStore'
  | 'hiringPosition'
  | 'hiringPosting'
  | 'hiringDetailTemplate'
>
type Counts = { created: number; skipped: number; conflict: number }

const SOURCE_SYSTEM = 'opening.work'
const CONFLICT_CODES = new Set([
  'Migration space conflict',
  'Migration source conflict',
  'Migration target conflict',
  'TEMPLATE_SOURCE_OR_TARGET_CONFLICT',
  'POSTING_UUID_TAKEN',
])
const isConflict = (error: unknown) => error instanceof Error && CONFLICT_CODES.has(error.message)

// packet은 prepare 뒤에 손댈 수 있으므로 적재 쪽에서 같은 검사를 다시 한다. 오류에 원문을 싣지 않는다.
function parsePacket<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw Error('PACKET_SCHEMA_REJECTED')
  return parsed.data
}

// 연락처 적중은 같은 내용을 사람이 승인했을 때만 통과한다. 민감 URL은 승인 대상이 아니다.
function assertClean(
  packet: unknown,
  approved?: { review?: ReviewApprovals; key: string; hash: () => string }
) {
  const hits = scanContacts(packet)
  if (hits.url) throw Error('HELD_SENSITIVE_URL')
  if (!contactCount(hits)) return
  const approvedHash = approved?.review?.items.get(approved.key)
  if (!approved || approvedHash !== approved.hash()) throw Error('HELD_CONTACT_PATTERN')
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

async function bindMaps(
  { resources, images }: Pick<PostingPacket['content'], 'resources' | 'images'>,
  bind: AssetBinder
) {
  const boundResources = Object.fromEntries(
    await Promise.all(
      Object.entries(resources).map(
        async ([id, { hasSceneSource, scene, ...asset }]) =>
          [id, { ...(await bind(asset)), hasSceneSource, scene }] as const
      )
    )
  )
  const boundImages = Object.fromEntries(
    await Promise.all(
      Object.entries(images).map(async ([key, asset]) => [key, await bind(asset)] as const)
    )
  )
  return { resources: boundResources, images: boundImages }
}

export async function planPosting(
  raw: unknown,
  spaceId: string,
  bind: AssetBinder,
  review?: ReviewApprovals
) {
  const packet = parsePacket(postingPacketSchema, raw)
  assertClean(packet, {
    review,
    key: `posting:${packet.sourcePostingId}`,
    hash: () => reviewHash(packet),
  })
  if (!isInMigrationWindow(packet.posting, new Date(packet.sourceSnapshotAt)))
    throw Error('OUT_OF_WINDOW')
  const { detailImage, ...text } = packet.content
  const content = {
    ...text,
    ...(detailImage ? { detailImage: await bind(detailImage) } : {}),
    ...(await bindMaps(packet.content, bind)),
  }
  // 폼·콘텐츠·용량·대상 자산 경로 검증은 v1 계획기를 그대로 쓴다. 비PII 필드는 비워서 넘긴다.
  const plan = planOpeningPosting(
    {
      sourceSpaceId: packet.sourceSpaceId,
      sourcePostingId: packet.sourcePostingId,
      sourceMemberId: null,
      sourceSnapshotAt: packet.sourceSnapshotAt,
      posting: { ...packet.posting, publishedAt: null, managerName: null, managerPhone: null },
      positions: packet.positions.map(({ sourceId, fields, createdAt, updatedAt }) => ({
        sourceId,
        fields,
        createdAt,
        updatedAt,
      })),
      storeIds: packet.sourceStoreIds,
      historicalStoreIds: packet.historicalStoreIds,
      preserveRepeatedCustomFields: true,
      rawSnapshot: null,
      content,
    },
    { sourceSpaceId: packet.sourceSpaceId, spaceId, author: null }
  )
  // 원장 스냅샷은 명시한 필드만 담는다. T는 빼서 재준비만으로 충돌이 나지 않게 한다.
  const snapshot = plain({
    sourceSpaceId: packet.sourceSpaceId,
    sourcePostingId: packet.sourcePostingId,
    posting: packet.posting,
    positions: packet.positions,
    sourceStoreIds: packet.sourceStoreIds,
    historicalStoreIds: packet.historicalStoreIds,
    content,
  })
  return { packet, form: plan.form, blocks: plan.content, snapshot, spaceId }
}
type PostingPlan = Awaited<ReturnType<typeof planPosting>>

export async function planTemplate(
  raw: unknown,
  spaceId: string,
  ownerUserId: string,
  bind: AssetBinder,
  review?: ReviewApprovals
) {
  const packet = parsePacket(templatePacketSchema, raw)
  assertClean(packet, {
    review,
    key: `template:${packet.sourceTemplateId}`,
    hash: () => reviewHash(packet),
  })
  const cover = packet.cover && (await bind(packet.cover))
  const maps = await bindMaps(packet, bind)
  const scope = { sourceSpaceId: packet.sourceSpaceId, sourceTemplateId: packet.sourceTemplateId }
  const input: OpeningTemplatePacket = {
    ...scope,
    sourceWebOrigin: packet.sourceWebOrigin,
    template: {
      id: packet.sourceTemplateId,
      brand_id: packet.sourceSpaceId,
      status: 1,
      name: packet.name,
      created_at: packet.createdAt,
      updated_at: packet.updatedAt,
      image_key: packet.cover?.ref ?? '',
      data: plain(packet.detail),
    },
    ...(cover ? { cover } : {}),
    content: {
      detail: plain(packet.detail),
      images: maps.images,
      resources: Object.fromEntries(
        Object.entries(maps.resources).map(([id, resource]) => [id, { ...resource, ...scope }])
      ),
    },
  }
  const target = { sourceSpaceId: packet.sourceSpaceId, spaceId, ownerUserId }
  return { input, target, plan: planOpeningTemplate(input, target) }
}
type TemplatePlan = Awaited<ReturnType<typeof planTemplate>>

const source = (sourceTable: string, sourceId: string) => ({
  sourceSystem: SOURCE_SYSTEM,
  sourceTable,
  sourceId,
  occurrence: '0',
})

function orgRecordInput(
  table: 'store' | 'position',
  targetModel: string,
  org: OrgPacket,
  spaceId: string,
  entry: OrgPacket['stores'][number] | OrgPacket['positions'][number]
): MigrationInput {
  return {
    ...source(table, entry.sourceId),
    spaceId,
    sourceSnapshotAt: new Date(org.sourceSnapshotAt),
    transformVersion: 'org-v1',
    snapshot: plain({ sourceSpaceId: org.sourceSpaceId, ...entry }),
    targetModel,
  }
}

const storeTarget = {
  read: (tx: Prisma.TransactionClient, id: string) => tx.hiringStore.findUnique({ where: { id } }),
  snapshot: (s: {
    name: string
    roadAddress: string | null
    detailAddress: string | null
    zipcode: string | null
    isActive: boolean
  }) => ({
    name: s.name,
    roadAddress: s.roadAddress,
    detailAddress: s.detailAddress,
    zipcode: s.zipcode,
    isActive: s.isActive,
  }),
}
const positionTarget = {
  read: (tx: Prisma.TransactionClient, id: string) =>
    tx.hiringPosition.findUnique({ where: { id } }),
  snapshot: (p: { name: string; category: string | null; isActive: boolean }) => ({
    name: p.name,
    category: p.category,
    isActive: p.isActive,
  }),
}
const postingInclude = {
  positions: { orderBy: { id: 'asc' as const } },
  stores: { orderBy: { storeId: 'asc' as const } },
  contents: { orderBy: { sortOrder: 'asc' as const } },
}
const postingTarget = {
  read: (tx: Prisma.TransactionClient, id: string) =>
    tx.hiringPosting.findUnique({ where: { id }, include: postingInclude }),
  // 관계까지 포함해 고객 편집·관계 변경을 덮어쓰지 않는다.
  snapshot: (posting: unknown) => plain(posting),
}

function postingRecordInput(plan: PostingPlan): MigrationInput {
  return {
    ...source('posting', plan.packet.sourcePostingId),
    spaceId: plan.spaceId,
    sourceSnapshotAt: new Date(plan.packet.sourceSnapshotAt),
    transformVersion: OPENING_TRANSFORM_VERSION,
    snapshot: plan.snapshot,
    targetModel: 'HiringPosting',
  }
}

async function ledgerTargetId(
  tx: Prisma.TransactionClient,
  table: 'store' | 'position',
  sourceId: string,
  spaceId: string
) {
  const record = await tx.hiringMigrationRecord.findUnique({
    where: { sourceRef: migrationSourceRef(source(table, sourceId)) },
  })
  if (!record || record.spaceId !== spaceId) throw Error('MIGRATION_REFERENCE_UNMAPPED')
  return record.targetId
}

async function importPosting(db: Pick<Db, '$transaction'>, plan: PostingPlan) {
  const { packet, form, blocks, spaceId } = plan
  return db.$transaction(
    async (tx) => {
      const storeIds = await Promise.all(
        packet.sourceStoreIds.map((id) => ledgerTargetId(tx, 'store', id, spaceId))
      )
      const positions = await Promise.all(
        packet.positions.map(async (position) => ({
          ...position,
          targetId: randomUUID(),
          positionId: await ledgerTargetId(tx, 'position', position.sourcePositionId, spaceId),
        }))
      )
      const result = await importMigrationRecord(tx, postingRecordInput(plan), {
        ...postingTarget,
        create: (transaction) =>
          transaction.hiringPosting.create({
            data: {
              uuid: packet.posting.uuid,
              spaceId,
              title: packet.posting.title,
              status: 'DRAFT',
              notificationEnabled: false,
              closingDate: packet.posting.closingDate ? new Date(packet.posting.closingDate) : null,
              // publishedAt이 있으면 초안도 폼·직무·매장 편집이 잠긴다(isPostingRecruitmentLocked).
              publishedAt: null,
              createdAt: new Date(packet.posting.createdAt),
              updatedAt: new Date(packet.posting.updatedAt),
              applicationEntries: form.fields as Prisma.InputJsonValue,
              positions: {
                create: positions.map((position) => ({
                  ...position.fields,
                  id: position.targetId,
                  positionId: position.positionId,
                  spaceId,
                  createdAt: new Date(position.createdAt),
                  updatedAt: new Date(position.updatedAt),
                })),
              },
              stores: { create: storeIds.map((storeId) => ({ storeId })) },
              contents: {
                create: blocks.blocks.map((block) => ({
                  ...block,
                  data:
                    block.data === null ? Prisma.JsonNull : (block.data as Prisma.InputJsonValue),
                  spaceId,
                  sourceType: 'POSTING_DETAIL' as const,
                })),
              },
            },
            include: postingInclude,
          }),
      })
      if (result.status === 'created') {
        result.record = await tx.hiringMigrationRecord.update({
          where: { id: result.record.id },
          data: {
            metadata: {
              sourceStatus: packet.posting.status,
              positionMap: positions.map((p) => ({ sourceId: p.sourceId, targetId: p.targetId })),
            },
          },
        })
      }
      return result
    },
    // scene JSON이 수 MB라 기본 5초를 넘길 수 있다.
    { timeout: 60_000 }
  )
}

function assetCopier(spaceId: string, readAsset: (sha256: string) => Promise<Uint8Array>) {
  return (asset: Asset, storage: TargetStorage) =>
    copyMigrationFile(
      {
        spaceId,
        sourceRef: `${SOURCE_SYSTEM}:asset:${asset.ref}`,
        expectedBytes: asset.sizeBytes,
        expectedSha256: asset.sha256,
        mimeType: asset.mimeType,
      },
      {
        readSource: () => readAsset(asset.sha256),
        readTarget: storage.read,
        writeTarget: storage.write,
      }
    )
}

// 경로 계산과 체크섬 검증만 메모리에서 끝낸다. 실제 Storage 쓰기는 충돌 검사 뒤에 한다.
function dryBinder(spaceId: string, readAsset: (sha256: string) => Promise<Uint8Array>) {
  const copy = assetCopier(spaceId, readAsset)
  const memory = new Map<string, Uint8Array>()
  const storage: TargetStorage = {
    read: async (path) => memory.get(path) ?? null,
    write: async (path, bytes) => void memory.set(path, bytes),
  }
  const assets = new Map<string, { asset: Asset; bound: Promise<VerifiedContentImage> }>()
  const bind: AssetBinder = (asset) => {
    const key = `${asset.ref}:${asset.sha256}`
    const known = assets.get(key)
    if (known) return known.bound
    const bound = copy(asset, storage).then((copied) => ({
      sourceImageKey: asset.ref,
      copiedImagePath: copied.path,
      verified: true,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
    }))
    assets.set(key, { asset, bound })
    return bound
  }
  return { bind, assets: () => [...assets.values()].map((value) => value.asset) }
}

type ImportIssue = { kind: string; id: string; code: string }
type ImportIssues = { conflicts: ImportIssue[]; refused: ImportIssue[] }

// id는 stdout에 남기지 않고 packet 폴더에만 쓴다. 지난 실행 결과가 남지 않게 지운다.
export function writeImportIssues(dir: string, issues: ImportIssues) {
  for (const [name, list] of Object.entries(issues)) {
    const path = join(dir, `${name}.json`)
    rmSync(path, { force: true })
    if (!list.length) continue
    writeFileSync(path, JSON.stringify(list, null, 2), { mode: 0o600 })
    chmodSync(path, 0o600)
  }
}

export async function runOpeningImport(
  db: Db,
  set: PacketSet,
  options: {
    spaceId: string
    brandId: string
    apply: boolean
    readAsset: (sha256: string) => Promise<Uint8Array>
    storage?: TargetStorage
    review?: unknown
    skipConflicts?: boolean
  }
) {
  const { spaceId, brandId, apply, readAsset, storage, skipConflicts } = options
  if (apply && !storage) throw Error('TARGET_STORAGE_REQUIRED')
  if (apply && options.review === undefined) throw Error('REVIEW_FILE_REQUIRED')
  const org = parsePacket(orgPacketSchema, set.org)
  // prepare와 같은 기준이다. 조직 이름은 키워드를 보지 않는다.
  const orgHits = scanContacts(org)
  if (orgHits.url) throw Error('HELD_SENSITIVE_URL')
  if (orgHits.phone + orgHits.email) throw Error('HELD_CONTACT_PATTERN')
  if (org.sourceSpaceId !== brandId) throw Error('PACKET_BRAND_MISMATCH')
  const review =
    options.review === undefined ? undefined : parseReviewFile(options.review, org.sourceSpaceId)
  const space = await db.space.findUnique({
    where: { id: spaceId },
    select: { id: true, name: true },
  })
  if (!space) throw Error('TARGET_SPACE_MISSING')
  const owner = await db.spaceMember.findFirst({
    where: { spaceId, role: 'OWNER' },
    select: { userId: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!owner) throw Error('TARGET_OWNER_MISSING')

  const issues: ImportIssues = { conflicts: [], refused: [] }
  // 검토하지 않은 이미지가 있는 항목은 자산 복사 대상에서도 뺀다.
  const refuseUnreviewed = (kind: string, id: string, shas: string[]) => {
    if (shas.every((sha) => review?.images.has(sha))) return false
    issues.refused.push({ kind, id, code: 'IMAGE_REVIEW_REQUIRED' })
    return true
  }
  const { bind, assets } = dryBinder(spaceId, readAsset)
  const postings: PostingPlan[] = []
  for (const raw of set.postings) {
    const packet = parsePacket(postingPacketSchema, raw)
    const images = unreadImages(packet.content, [packet.content.detailImage])
    if (refuseUnreviewed('posting', packet.sourcePostingId, images)) continue
    postings.push(await planPosting(packet, spaceId, bind, review))
  }
  const templates: TemplatePlan[] = []
  for (const raw of set.templates) {
    const packet = parsePacket(templatePacketSchema, raw)
    const images = unreadImages(packet, [packet.cover])
    if (refuseUnreviewed('template', packet.sourceTemplateId, images)) continue
    templates.push(await planTemplate(packet, spaceId, owner.userId, bind, review))
  }

  const storeIds = new Set(org.stores.map((s) => s.sourceId))
  const positionIds = new Set(org.positions.map((p) => p.sourceId))
  for (const { packet } of postings) {
    if (packet.sourceSpaceId !== org.sourceSpaceId) throw Error('PACKET_SCOPE_MISMATCH')
    if (
      packet.sourceStoreIds.some((id) => !storeIds.has(id)) ||
      packet.positions.some((p) => !positionIds.has(p.sourcePositionId))
    )
      throw Error('MIGRATION_REFERENCE_UNMAPPED')
  }
  if (templates.some((t) => t.input.sourceSpaceId !== org.sourceSpaceId))
    throw Error('PACKET_SCOPE_MISMATCH')

  const empty = (): Counts => ({ created: 0, skipped: 0, conflict: 0 })
  const report = {
    targetSpaceName: space.name,
    refused: {
      postings: issues.refused.filter((item) => item.kind === 'posting').length,
      templates: issues.refused.filter((item) => item.kind === 'template').length,
    },
    stores: empty(),
    positions: empty(),
    templates: empty(),
    postings: empty(),
    assets: { total: assets().length, created: 0, skipped: 0 },
    // 원장 밖에 이미 있는 같은 이름. 중복 생성을 운영자가 판단하도록 알린다.
    sameNameInTarget: {
      stores: await db.hiringStore.count({
        where: { spaceId, name: { in: org.stores.map((s) => s.name) } },
      }),
      positions: await db.hiringPosition.count({
        where: { spaceId, name: { in: org.positions.map((p) => p.name) } },
      }),
    },
  }
  const tx = db as unknown as Prisma.TransactionClient
  const steps: {
    kind: string
    id: string
    counts: Counts
    check: () => Promise<unknown>
    write: () => Promise<{ status: 'created' | 'existing' }>
  }[] = [
    ...org.stores.map((store) => {
      const input = orgRecordInput('store', 'HiringStore', org, spaceId, store)
      return {
        kind: 'store',
        id: store.sourceId,
        counts: report.stores,
        check: () => findExistingMigrationRecord(tx, input, storeTarget),
        write: () =>
          db.$transaction((transaction) =>
            importMigrationRecord(transaction, input, {
              ...storeTarget,
              create: (client) =>
                client.hiringStore.create({
                  data: {
                    spaceId,
                    name: store.name,
                    roadAddress: store.roadAddress,
                    detailAddress: store.detailAddress,
                    zipcode: store.zipcode,
                    isActive: store.isActive,
                    createdAt: new Date(store.createdAt),
                    updatedAt: new Date(store.updatedAt),
                  },
                }),
            })
          ),
      }
    }),
    ...org.positions.map((position) => {
      const input = orgRecordInput('position', 'HiringPosition', org, spaceId, position)
      return {
        kind: 'position',
        id: position.sourceId,
        counts: report.positions,
        check: () => findExistingMigrationRecord(tx, input, positionTarget),
        write: () =>
          db.$transaction((transaction) =>
            importMigrationRecord(transaction, input, {
              ...positionTarget,
              create: (client) =>
                client.hiringPosition.create({
                  data: {
                    spaceId,
                    name: position.name,
                    category: position.category,
                    isActive: position.isActive,
                    createdAt: new Date(position.createdAt),
                    updatedAt: new Date(position.updatedAt),
                  },
                }),
            })
          ),
      }
    }),
    ...templates.map(({ input, target, plan }) => ({
      kind: 'template',
      id: input.sourceTemplateId,
      counts: report.templates,
      check: () => findExistingOpeningTemplate(tx, plan, spaceId),
      write: () => importOpeningTemplate(db, input, target),
    })),
    ...postings.map((plan) => ({
      kind: 'posting',
      id: plan.packet.sourcePostingId,
      counts: report.postings,
      check: async () => {
        const existing = await findExistingMigrationRecord(
          tx,
          postingRecordInput(plan),
          postingTarget
        )
        if (existing) return existing
        const taken = await db.hiringPosting.findUnique({
          where: { uuid: plan.packet.posting.uuid },
          select: { id: true },
        })
        if (taken) throw Error('POSTING_UUID_TAKEN')
        return null
      },
      write: () => importPosting(db, plan),
    })),
  ]

  // 쓰기 전에 전체를 읽어서 판정한다. 기본은 충돌이 하나라도 있으면 아무것도 쓰지 않는다.
  const conflicted = new Set<(typeof steps)[number]>()
  const addConflict = (step: (typeof steps)[number], error: unknown) => {
    step.counts.conflict++
    conflicted.add(step)
    const code = error instanceof Error ? error.message : 'CONFLICT'
    issues.conflicts.push({ kind: step.kind, id: step.id, code })
  }
  for (const step of steps) {
    try {
      step.counts[(await step.check()) ? 'skipped' : 'created']++
    } catch (error) {
      if (!isConflict(error)) throw error
      addConflict(step, error)
    }
  }
  // 원장 밖의 같은 이름만 남긴다. 재실행에서 이미 옮긴 항목을 중복으로 알리지 않는다.
  report.sameNameInTarget.stores = Math.max(
    0,
    report.sameNameInTarget.stores - report.stores.skipped
  )
  report.sameNameInTarget.positions = Math.max(
    0,
    report.sameNameInTarget.positions - report.positions.skipped
  )
  if (conflicted.size && !skipConflicts)
    return { status: 'CONFLICT_STOPPED' as const, ...report, issues }
  if (!apply) return { status: 'PLANNED' as const, ...report, issues }

  const copy = assetCopier(spaceId, readAsset)
  for (const asset of assets()) {
    const copied = await copy(asset, storage as TargetStorage)
    report.assets[copied.status === 'created' ? 'created' : 'skipped']++
  }
  for (const counts of [report.stores, report.positions, report.templates, report.postings])
    Object.assign(counts, { created: 0, skipped: 0 })
  for (const step of steps) {
    if (conflicted.has(step)) continue
    try {
      const result = await step.write()
      step.counts[result.status === 'created' ? 'created' : 'skipped']++
    } catch (error) {
      // 건너뛴 매장·직무에 기대는 공고도 항목 단위로 넘긴다.
      const unmapped = error instanceof Error && error.message === 'MIGRATION_REFERENCE_UNMAPPED'
      if (!isConflict(error) && !(skipConflicts && unmapped)) throw error
      addConflict(step, error)
      if (!skipConflicts) return { status: 'CONFLICT_STOPPED' as const, ...report, issues }
    }
  }
  const partial = issues.conflicts.length || issues.refused.length
  return {
    status: partial ? ('APPLIED_PARTIAL' as const) : ('APPLIED' as const),
    ...report,
    issues,
  }
}

const PRODUCTION_REF = 'duyteczbadcuvfeawlzu'
const DEVELOPMENT_REF = 'tumkfkfgzkmisguyaghn'

// 개발 프로젝트로 확인되지 않으면 전부 운영으로 본다. pooler URL은 ref가 사용자명에 있어 URL 전체를 본다.
export function assertImportTarget(
  env: Record<string, string | undefined>,
  options: { brandId: string; targetSpace: string; confirmProd?: string }
) {
  if (!env.DATABASE_URL && !env.DIRECT_URL) throw Error('TARGET_DATABASE_REQUIRED')
  const urls = [env.DATABASE_URL, env.DIRECT_URL, env.NEXT_PUBLIC_SUPABASE_URL]
    .filter((value): value is string => !!value)
    .map((url) => url.toLowerCase())
  const hasDev = urls.some((url) => url.includes(DEVELOPMENT_REF))
  if (urls.every((url) => url.includes(DEVELOPMENT_REF))) return 'development' as const
  const hasProd = urls.some((url) => url.includes(PRODUCTION_REF))
  if (hasDev || (hasProd && !urls.every((url) => url.includes(PRODUCTION_REF))))
    throw Error('TARGET_PROJECT_MISMATCH')
  if (options.confirmProd !== `${options.brandId}:${options.targetSpace}`)
    throw Error('PRODUCTION_CONFIRM_REQUIRED')
  return hasProd ? ('production' as const) : ('unidentified' as const)
}
